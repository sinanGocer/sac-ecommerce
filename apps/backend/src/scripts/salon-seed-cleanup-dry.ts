import { promises as fs } from "fs"
import path from "path"

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { SEARCH_PROJECTION_MODULE } from "../modules/search-projection"
import SearchProjectionService from "../modules/search-projection/service"
import {
  ALLOWLISTED_SEED_PRODUCTS,
  ProductReferenceCounts,
  SeedProductSnapshot,
} from "../salon-seed-cleanup/salon-seed-cleanup-policy"
import { buildSalonSeedCleanupReport } from "../salon-seed-cleanup/salon-seed-cleanup-report"
import { planSalonSeedCleanup } from "../salon-seed-cleanup/salon-seed-cleanup-service"

/**
 * Salon Seed Cleanup — DRY-RUN ONLY.
 *
 * Produces an allowlisted cleanup plan for the five local salon seed demo
 * products. It does not call product workflows, projection writers, or any DB
 * mutation path.
 */

const REPORTS_DIR = path.resolve(process.cwd(), "salon-seed-cleanup-reports")
const LATEST_REPORT = path.join(REPORTS_DIR, "salon-seed-cleanup-latest.json")
const SCAN_TAKE = 200
const SCAN_CAP = 50000

type QueryGraph = {
  graph: (args: unknown, options?: unknown) => Promise<{ data?: unknown[] }>
}

interface ProductGraphRow {
  id: string
  title?: string | null
  handle?: string | null
  status?: string | null
  metadata?: Record<string, unknown> | null
  variants?: Array<{ id?: string | null; sku?: string | null; prices?: Array<{ id?: string | null }> | null }> | null
  images?: Array<{ id?: string | null }> | null
  categories?: Array<{ id?: string | null }> | null
  sales_channels?: Array<{ id?: string | null; name?: string | null }> | null
}

export default async function salonSeedCleanupDry({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const startedAt = new Date().toISOString()

  const productIds: string[] = ALLOWLISTED_SEED_PRODUCTS.map((p) => p.product_id)
  const { data } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "handle",
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
    filters: { id: productIds },
  })

  const productRows = ((data ?? []) as ProductGraphRow[]).filter((row) =>
    productIds.includes(row.id)
  )
  const projectionByProductId = await loadProjections(container, productIds)
  const cartRefs = await countCartLines(query, productIds, logger)
  const orderRefs = await countOrderLines(query, productIds, logger)

  const snapshots = productRows.map((row) =>
    toSnapshot(row, projectionByProductId.get(row.id) ?? null)
  )
  const countsByProductId: Record<string, ProductReferenceCounts> = {}
  for (const snapshot of snapshots) {
    const row = productRows.find((product) => product.id === snapshot.product_id)
    const variants = row?.variants ?? []
    countsByProductId[snapshot.product_id] = {
      active_cart_lines: cartRefs.get(snapshot.product_id)?.active ?? 0,
      completed_cart_lines: cartRefs.get(snapshot.product_id)?.completed ?? 0,
      order_lines: orderRefs.get(snapshot.product_id)?.lines ?? 0,
      order_items: orderRefs.get(snapshot.product_id)?.items ?? 0,
      blocking_order_lines: orderRefs.get(snapshot.product_id)?.blockingLines ?? 0,
      safe_test_order_lines: orderRefs.get(snapshot.product_id)?.safeTestLines ?? 0,
      variant_count: variants.length,
      price_count: variants.reduce((sum, variant) => sum + (variant.prices?.length ?? 0), 0),
      image_count: row?.images?.length ?? 0,
      sales_channel_relations: snapshot.sales_channels.length,
      category_relations: row?.categories?.length ?? 0,
      projection_count: snapshot.projection ? 1 : 0,
    }
  }

  const plan = planSalonSeedCleanup({ snapshots, countsByProductId })
  const finishedAt = new Date().toISOString()
  const runId = `ssc_${Date.now().toString(36)}_${(plan.plan_fingerprint ?? "noplan").slice(0, 8)}`
  const report = buildSalonSeedCleanupReport({
    runId,
    startedAt,
    finishedAt,
    snapshots,
    countsByProductId,
    plan,
  })

  await writeReport(report)
  logSummary(logger, report)
}

function toSnapshot(
  row: ProductGraphRow,
  projection: { id: string; product_id: string } | null
): SeedProductSnapshot {
  return {
    product_id: row.id,
    title: row.title ?? null,
    handle: row.handle ?? null,
    status: row.status ?? "unknown",
    metadata: row.metadata ?? {},
    variant_skus: (row.variants ?? [])
      .map((variant) => variant.sku)
      .filter((sku): sku is string => typeof sku === "string" && sku.length > 0),
    sales_channels: (row.sales_channels ?? [])
      .filter((channel) => typeof channel.id === "string")
      .map((channel) => ({
        id: channel.id as string,
        name: channel.name ?? null,
      })),
    projection,
  }
}

async function loadProjections(
  container: ExecArgs["container"],
  productIds: string[]
): Promise<Map<string, { id: string; product_id: string }>> {
  const result = new Map<string, { id: string; product_id: string }>()
  try {
    const service = container.resolve<SearchProjectionService>(SEARCH_PROJECTION_MODULE)
    const rows = (await service.listProductSearchProjections(
      { product_id: productIds },
      { select: ["id", "product_id"], take: productIds.length + 5 }
    )) as Array<{ id: string; product_id: string }>
    for (const row of rows) result.set(row.product_id, row)
  } catch {
    // Projection module unavailable => no projection action is planned.
  }
  return result
}

async function countCartLines(
  query: QueryGraph,
  productIds: string[],
  logger: { warn: (m: string) => void }
): Promise<Map<string, { active: number; completed: number }>> {
  const ids = new Set(productIds)
  const result = new Map<string, { active: number; completed: number }>()
  let skip = 0
  let scanned = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let rows: unknown[] = []
    try {
      const response = await query.graph({
        entity: "cart",
        fields: ["id", "completed_at", "deleted_at", "items.product_id"],
        pagination: { skip, take: SCAN_TAKE },
      })
      rows = response.data ?? []
    } catch (error) {
      logger.warn(
        `[salon-seed:cleanup] cart taraması başarısız: ${error instanceof Error ? error.message : String(error)}`
      )
      break
    }
    const carts = rows as Array<{
      completed_at?: string | Date | null
      deleted_at?: string | Date | null
      items?: Array<{ product_id?: string | null }> | null
    }>
    if (carts.length === 0) break
    for (const cart of carts) {
      for (const item of cart.items ?? []) {
        if (!item.product_id || !ids.has(item.product_id)) continue
        const current = result.get(item.product_id) ?? { active: 0, completed: 0 }
        // active = açık sepet (completed_at==null && deleted_at==null) → blocking.
        // completed_at!=null → historical completed cart → blocking DEĞİL.
        if (cart.completed_at != null) current.completed += 1
        else if (cart.deleted_at == null) current.active += 1
        result.set(item.product_id, current)
      }
    }
    scanned += carts.length
    skip += carts.length
    if (carts.length < SCAN_TAKE || scanned >= SCAN_CAP) break
  }
  return result
}

interface OrderRefTally {
  lines: number
  items: number
  blockingLines: number
  safeTestLines: number
}

/**
 * Bir order "safe test" sayılır (engellemez) yalnız ŞU AN tüm koşullarda:
 *   canceled_at != null && metadata.test_order === true &&
 *   captured_amount == 0 && refunded_amount == 0 &&
 *   aktif fulfillment yok && return yok.
 * Aksi her durumda (active order, non-test historical, captured/refunded/
 * fulfilled/returned) → blocking.
 */
function isSafeTestOrder(order: {
  canceled_at?: string | Date | null
  metadata?: Record<string, unknown> | null
  payment_collections?: Array<{ captured_amount?: number | string | null; refunded_amount?: number | string | null }> | null
  fulfillments?: Array<{ canceled_at?: string | Date | null }> | null
  _return_count?: number
}): boolean {
  if (order.canceled_at == null) return false
  if ((order.metadata ?? {})?.test_order !== true) return false
  const captured = (order.payment_collections ?? []).reduce(
    (sum, pc) => sum + (Number(pc.captured_amount ?? 0) || 0),
    0
  )
  const refunded = (order.payment_collections ?? []).reduce(
    (sum, pc) => sum + (Number(pc.refunded_amount ?? 0) || 0),
    0
  )
  if (captured > 0 || refunded > 0) return false
  const activeFulfillments = (order.fulfillments ?? []).filter(
    (f) => f.canceled_at == null
  ).length
  if (activeFulfillments > 0) return false
  if ((order._return_count ?? 0) > 0) return false
  return true
}

async function countOrderLines(
  query: QueryGraph,
  productIds: string[],
  logger: { warn: (m: string) => void }
): Promise<Map<string, OrderRefTally>> {
  const ids = new Set(productIds)
  const result = new Map<string, OrderRefTally>()
  let skip = 0
  let scanned = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let rows: unknown[] = []
    try {
      const response = await query.graph({
        entity: "order",
        fields: [
          "id",
          "canceled_at",
          "deleted_at",
          "metadata",
          "items.product_id",
          "items.quantity",
          "fulfillments.id",
          "fulfillments.canceled_at",
          "payment_collections.captured_amount",
          "payment_collections.refunded_amount",
        ],
        pagination: { skip, take: SCAN_TAKE },
      })
      rows = response.data ?? []
    } catch (error) {
      logger.warn(
        `[salon-seed:cleanup] order taraması başarısız: ${error instanceof Error ? error.message : String(error)}`
      )
      break
    }
    const orders = rows as Array<{
      id: string
      canceled_at?: string | Date | null
      deleted_at?: string | Date | null
      metadata?: Record<string, unknown> | null
      items?: Array<{ product_id?: string | null; quantity?: number | string | null }> | null
      fulfillments?: Array<{ canceled_at?: string | Date | null }> | null
      payment_collections?: Array<{ captured_amount?: number | string | null; refunded_amount?: number | string | null }> | null
    }>
    if (orders.length === 0) break
    for (const order of orders) {
      const matching = (order.items ?? []).filter(
        (i) => i.product_id && ids.has(i.product_id)
      )
      if (matching.length === 0) continue
      // return sayısı — defansif ayrı sorgu (sınıflandırma için).
      let returnCount = 0
      try {
        const { data } = await query.graph({
          entity: "return",
          fields: ["id"],
          filters: { order_id: order.id },
        })
        returnCount = (data ?? []).length
      } catch {
        returnCount = 0
      }
      const safe = isSafeTestOrder({ ...order, _return_count: returnCount })
      for (const item of matching) {
        const pid = item.product_id as string
        const current =
          result.get(pid) ?? { lines: 0, items: 0, blockingLines: 0, safeTestLines: 0 }
        current.lines += 1
        const qty = typeof item.quantity === "number" ? item.quantity : Number(item.quantity ?? 0)
        current.items += Number.isFinite(qty) ? qty : 0
        if (safe) current.safeTestLines += 1
        else current.blockingLines += 1
        result.set(pid, current)
      }
    }
    scanned += orders.length
    skip += orders.length
    if (orders.length < SCAN_TAKE || scanned >= SCAN_CAP) break
  }
  return result
}

async function writeReport(report: ReturnType<typeof buildSalonSeedCleanupReport>): Promise<void> {
  await fs.mkdir(REPORTS_DIR, { recursive: true })
  const stamp = report.finished_at.replace(/[:.]/g, "-")
  const fp = report.plan_fingerprint ?? "noplan"
  const json = JSON.stringify(report, null, 2)
  await fs.writeFile(
    path.join(REPORTS_DIR, `salon-seed-cleanup-${stamp}-${fp}.json`),
    json,
    "utf-8"
  )
  await fs.writeFile(LATEST_REPORT, json, "utf-8")
}

function logSummary(
  logger: { info: (m: string) => void; warn: (m: string) => void },
  report: ReturnType<typeof buildSalonSeedCleanupReport>
): void {
  logger.info("──────────── SALON SEED CLEANUP DRY-RUN ────────────")
  logger.info(
    `decision=${report.final_decision} matched=${report.matched_product_ids.length} missing=${report.missing_product_ids.length} db_writes=${report.db_writes}`
  )
  logger.info(
    `reference_gate=${report.reference_gate.ok ? "ok" : "blocked"} blocked=${report.reference_gate.blocked_product_ids.join(",") || "-"}`
  )
  logger.info(`plan_fingerprint=${report.plan_fingerprint ?? "-"}`)
  for (const action of report.planned_actions) {
    logger.info(
      `  - ${action.product_id} ${action.action}: status=${action.status} executed=${action.executed} db_writes=${action.db_writes}`
    )
  }
  if (report.errors.length > 0) {
    report.errors.forEach((error) => logger.warn(`[salon-seed:cleanup] ${error}`))
  }
  logger.info("Rapor: salon-seed-cleanup-reports/salon-seed-cleanup-latest.json")
}
