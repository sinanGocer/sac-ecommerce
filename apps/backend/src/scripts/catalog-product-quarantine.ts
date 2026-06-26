import { promises as fs } from "fs"
import path from "path"

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  linkProductsToSalesChannelWorkflow,
  updateProductsWorkflow,
} from "@medusajs/medusa/core-flows"

import { SEARCH_PROJECTION_MODULE } from "../modules/search-projection"
import SearchProjectionService from "../modules/search-projection/service"
import { isConfirmationValid } from "../catalog-cleanup/quarantine-fingerprint"
import {
  PlannedAction,
  ProductSnapshot,
  QuarantineDecision,
  ReferenceCounts,
  TARGET_PRODUCT_STATUS,
} from "../catalog-cleanup/quarantine-policy"
import {
  QuarantinePlan,
  planQuarantine,
} from "../catalog-cleanup/quarantine-service"
import { buildReport } from "../catalog-cleanup/quarantine-report"

/**
 * Catalog Product Quarantine — tek ürün için güvenli unpublish/detach/projection
 * temizliği. VARSAYILAN: DRY-RUN (DB write 0). Gerçek commit yalnız
 * CATALOG_QUARANTINE_COMMIT=true + CATALOG_QUARANTINE_CONFIRM=<plan_fingerprint>
 * birlikte verildiğinde ve plan DRY_RUN_READY ise yapılır. RAW SQL YOK; tüm
 * yazımlar Medusa workflow/servis katmanından geçer.
 */

const REPORTS_DIR = path.resolve(process.cwd(), "catalog-cleanup-reports")
const LATEST_REPORT = path.join(REPORTS_DIR, "catalog-quarantine-latest.json")
const SCAN_TAKE = 200
const SCAN_CAP = 50000

interface ProductGraphRow {
  id: string
  title?: string | null
  status?: string | null
  metadata?: Record<string, unknown> | null
  variants?: Array<{ id?: string | null; sku?: string | null; prices?: Array<{ id?: string | null }> | null }> | null
  images?: Array<{ id?: string | null }> | null
  categories?: Array<{ id?: string | null }> | null
  sales_channels?: Array<{ id?: string | null; name?: string | null }> | null
}

type QueryGraph = {
  graph: (args: unknown, options?: unknown) => Promise<{ data?: unknown[] }>
}

export default async function catalogProductQuarantine({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const requestedProductId = (process.env.CATALOG_QUARANTINE_PRODUCT_ID ?? "").trim()
  if (!requestedProductId) {
    throw new Error(
      "[catalog:quarantine] Fail-closed: CATALOG_QUARANTINE_PRODUCT_ID zorunlu."
    )
  }
  if (!/^prod_[A-Za-z0-9]+$/.test(requestedProductId)) {
    throw new Error(
      `[catalog:quarantine] Fail-closed: geçersiz product id biçimi: "${requestedProductId}".`
    )
  }

  const commitEnabled = process.env.CATALOG_QUARANTINE_COMMIT === "true"
  const confirmToken = process.env.CATALOG_QUARANTINE_CONFIRM ?? null
  const mode: "dry-run" | "commit" = commitEnabled ? "commit" : "dry-run"

  const startedAt = new Date().toISOString()

  // ── Read-only: ürün + referans toplama ────────────────────────────────────
  const { data: productRows } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "status",
      "metadata",
      "variants.id",
      "variants.sku",
      "variants.prices.id",
      "images.id",
      "categories.id",
      "sales_channels.id",
      "sales_channels.name",
    ],
    filters: { id: requestedProductId },
  })
  const rows = (productRows ?? []) as ProductGraphRow[]
  const matchedProductIds = rows
    .map((r) => r.id)
    .filter((id): id is string => typeof id === "string")

  let snapshot: ProductSnapshot | null = null
  let counts: ReferenceCounts | null = null

  if (rows.length === 1) {
    const row = rows[0]
    const variants = row.variants ?? []
    const variantIds = variants
      .map((v) => v.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
    const variantSkus = variants
      .map((v) => v.sku)
      .filter((s): s is string => typeof s === "string" && s.length > 0)
    const priceCount = variants.reduce((sum, v) => sum + (v.prices?.length ?? 0), 0)
    const salesChannels = (row.sales_channels ?? [])
      .filter((c) => typeof c.id === "string")
      .map((c) => ({ id: c.id as string, name: c.name ?? null }))

    const projection = await loadProjection(container, row.id)
    const cartTally = await countCartLines(query, row.id, logger)
    const orderTally = await countOrderLines(query, row.id, logger)
    const inventoryRelations = await countInventoryRelations(query, variantIds)

    snapshot = {
      product_id: row.id,
      title: row.title ?? null,
      status: row.status ?? "unknown",
      metadata: row.metadata ?? {},
      variant_skus: variantSkus,
      sales_channels: salesChannels,
      projection: projection ? { id: projection.id, product_id: row.id } : null,
    }
    counts = {
      active_cart_lines: cartTally.active,
      completed_cart_lines: cartTally.completed,
      order_lines: orderTally.lines,
      order_items: orderTally.items,
      inventory_relations: inventoryRelations,
      variant_count: variants.length,
      price_count: priceCount,
      image_count: row.images?.length ?? 0,
      sales_channel_relations: salesChannels.length,
      category_relations: row.categories?.length ?? 0,
      projection_count: projection ? 1 : 0,
    }
  }

  const plan = planQuarantine({
    requestedProductId,
    matchedProductIds,
    snapshot,
    counts,
  })

  // ── Aksiyonlar (dry-run: hepsi planned/no_op, executed=false) ──────────────
  let actions: PlannedAction[] = plan.actions
  let dbWrites = 0
  let projectionWrites = 0
  let finalDecision: QuarantineDecision = plan.decision

  if (mode === "commit") {
    const exec = await runCommit(container, plan, snapshot, confirmToken, logger)
    actions = exec.actions
    dbWrites = exec.dbWrites
    projectionWrites = exec.projectionWrites
    finalDecision = exec.decision
  }

  const finishedAt = new Date().toISOString()
  const runId = `cpq_${Date.now().toString(36)}_${(plan.plan_fingerprint ?? "noplan").slice(0, 8)}`

  const report = buildReport({
    runId,
    startedAt,
    finishedAt,
    mode,
    snapshot,
    counts,
    plan,
    commitEnabled,
    dbWrites,
    projectionWrites,
    finalDecision,
    actions,
  })

  await writeReport(report, runId)
  logSummary(logger, report)
}

// ── Commit yürütücü (bu görevde çalıştırılmaz; tasarım fail-closed) ──────────

async function runCommit(
  container: ExecArgs["container"],
  plan: QuarantinePlan,
  snapshot: ProductSnapshot | null,
  confirmToken: string | null,
  logger: { info: (m: string) => void }
): Promise<{
  actions: PlannedAction[]
  dbWrites: number
  projectionWrites: number
  decision: QuarantineDecision
}> {
  if (plan.decision !== "QUARANTINE_DRY_RUN_READY" || !plan.plan_fingerprint || !snapshot) {
    throw new Error(
      `[catalog:quarantine] Fail-closed: plan commit'e uygun değil (decision=${plan.decision}). Yazım yapılmadı.`
    )
  }
  // Confirmation: token yalnız plan_fingerprint olmalı; aksi halde writer ÇAĞRILMAZ.
  if (!isConfirmationValid(confirmToken, plan.plan_fingerprint)) {
    throw new Error(
      "[catalog:quarantine] Fail-closed: CATALOG_QUARANTINE_CONFIRM plan_fingerprint ile eşleşmiyor. Yazım yapılmadı."
    )
  }

  const actions = plan.actions.map((a) => ({ ...a, detail: { ...a.detail } }))
  let dbWrites = 0
  let projectionWrites = 0

  for (const action of actions) {
    if (action.status === "no_op") continue
    if (action.action === "PRODUCT_UNPUBLISH") {
      await updateProductsWorkflow(container).run({
        input: {
          selector: { id: snapshot.product_id },
          update: { status: TARGET_PRODUCT_STATUS },
        },
      })
      action.executed = true
      action.db_writes = 1
      dbWrites += 1
    } else if (action.action === "SALES_CHANNEL_DETACH") {
      for (const channel of snapshot.sales_channels) {
        await linkProductsToSalesChannelWorkflow(container).run({
          input: { id: channel.id, remove: [snapshot.product_id] },
        })
      }
      action.executed = true
      action.db_writes = snapshot.sales_channels.length
      dbWrites += snapshot.sales_channels.length
    } else if (action.action === "PROJECTION_REMOVE_OR_HIDE") {
      if (snapshot.projection) {
        const service = container.resolve<SearchProjectionService>(
          SEARCH_PROJECTION_MODULE
        )
        await service.deleteProductSearchProjections([snapshot.projection.id])
        action.executed = true
        action.db_writes = 1
        projectionWrites += 1
      }
    }
  }

  const anyExecuted = actions.some((a) => a.executed)
  logger.info(
    `[catalog:quarantine] commit yürütüldü — db_writes=${dbWrites} projection_writes=${projectionWrites}`
  )
  return {
    actions,
    dbWrites,
    projectionWrites,
    decision: anyExecuted ? "QUARANTINE_COMMITTED" : "QUARANTINE_IDEMPOTENT_NOOP",
  }
}

// ── Read-only referans toplayıcılar ─────────────────────────────────────────

async function loadProjection(
  container: ExecArgs["container"],
  productId: string
): Promise<{ id: string } | null> {
  try {
    const service = container.resolve<SearchProjectionService>(
      SEARCH_PROJECTION_MODULE
    )
    const rows = (await service.listProductSearchProjections(
      { product_id: [productId] },
      { select: ["id", "product_id"], take: 2 }
    )) as Array<{ id: string }>
    return rows.length > 0 ? { id: rows[0].id } : null
  } catch {
    return null
  }
}

async function countCartLines(
  query: QueryGraph,
  productId: string,
  logger: { warn: (m: string) => void }
): Promise<{ active: number; completed: number }> {
  let active = 0
  let completed = 0
  let skip = 0
  let scanned = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let data: unknown[] = []
    try {
      const res = await query.graph({
        entity: "cart",
        fields: ["id", "completed_at", "items.product_id"],
        pagination: { skip, take: SCAN_TAKE },
      })
      data = res.data ?? []
    } catch (error) {
      logger.warn(
        `[catalog:quarantine] cart taraması başarısız: ${error instanceof Error ? error.message : String(error)}`
      )
      break
    }
    const carts = data as Array<{
      completed_at?: string | Date | null
      items?: Array<{ product_id?: string | null }> | null
    }>
    if (carts.length === 0) break
    for (const cart of carts) {
      const matching = (cart.items ?? []).filter((i) => i.product_id === productId).length
      if (matching === 0) continue
      if (cart.completed_at == null) active += matching
      else completed += matching
    }
    scanned += carts.length
    skip += carts.length
    if (carts.length < SCAN_TAKE || scanned >= SCAN_CAP) break
  }
  return { active, completed }
}

async function countOrderLines(
  query: QueryGraph,
  productId: string,
  logger: { warn: (m: string) => void }
): Promise<{ lines: number; items: number }> {
  let lines = 0
  let items = 0
  let skip = 0
  let scanned = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let data: unknown[] = []
    try {
      const res = await query.graph({
        entity: "order",
        fields: ["id", "items.product_id", "items.quantity"],
        pagination: { skip, take: SCAN_TAKE },
      })
      data = res.data ?? []
    } catch (error) {
      logger.warn(
        `[catalog:quarantine] order taraması başarısız: ${error instanceof Error ? error.message : String(error)}`
      )
      break
    }
    const orders = data as Array<{
      items?: Array<{ product_id?: string | null; quantity?: number | string | null }> | null
    }>
    if (orders.length === 0) break
    for (const order of orders) {
      for (const item of order.items ?? []) {
        if (item.product_id !== productId) continue
        lines += 1
        const qty = typeof item.quantity === "number" ? item.quantity : Number(item.quantity ?? 0)
        items += Number.isFinite(qty) ? qty : 0
      }
    }
    scanned += orders.length
    skip += orders.length
    if (orders.length < SCAN_TAKE || scanned >= SCAN_CAP) break
  }
  return { lines, items }
}

async function countInventoryRelations(
  query: QueryGraph,
  variantIds: string[]
): Promise<number> {
  if (variantIds.length === 0) return 0
  try {
    const res = await query.graph({
      entity: "product_variant_inventory_items",
      fields: ["variant_id"],
      filters: { variant_id: variantIds },
    })
    return (res.data ?? []).length
  } catch {
    return 0
  }
}

// ── Rapor yazımı & özet ──────────────────────────────────────────────────────

async function writeReport(
  report: ReturnType<typeof buildReport>,
  runId: string
): Promise<void> {
  await fs.mkdir(REPORTS_DIR, { recursive: true })
  const stamp = report.finished_at.replace(/[:.]/g, "-")
  const fp = report.plan_fingerprint ?? "noplan"
  const json = JSON.stringify(report, null, 2)
  await fs.writeFile(
    path.join(REPORTS_DIR, `catalog-quarantine-${stamp}-${fp}.json`),
    json,
    "utf-8"
  )
  await fs.writeFile(LATEST_REPORT, json, "utf-8")
  void runId
}

function logSummary(
  logger: { info: (m: string) => void; warn: (m: string) => void },
  report: ReturnType<typeof buildReport>
): void {
  logger.info("──────────── CATALOG QUARANTINE ÖZET ────────────")
  logger.info(
    `mode=${report.mode} decision=${report.final_decision} requested=${report.allowlist_result.requested_count} matched=${report.allowlist_result.matched_count}`
  )
  logger.info(
    `unpublish_allowed=${report.gate_results.unpublish_allowed} delete_allowed=${report.gate_results.delete_allowed} active_cart_lines=${report.reference_counts?.active_cart_lines ?? "-"} order_references=${(report.reference_counts?.order_lines ?? 0) + (report.reference_counts?.order_items ?? 0)}`
  )
  logger.info(
    `db_writes=${report.db_writes} projection_writes=${report.projection_writes} plan_fingerprint=${report.plan_fingerprint ?? "-"}`
  )
  for (const action of [...report.planned_actions, ...report.skipped_actions]) {
    logger.info(`  - ${action.action}: status=${action.status} executed=${action.executed} db_writes=${action.db_writes}`)
  }
  if (report.errors.length > 0) {
    report.errors.forEach((e) => logger.warn(`[catalog:quarantine] error: ${e}`))
  }
  if (report.mode === "dry-run" && report.commit_command) {
    logger.info(`Commit komutu (çalıştırılmadı): ${report.commit_command}`)
  }
  logger.info("Rapor: catalog-cleanup-reports/catalog-quarantine-latest.json")
}
