import { promises as fs } from "fs"
import path from "path"

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { deleteLineItemsWorkflow } from "@medusajs/medusa/core-flows"

import { isCartConfirmationValid } from "../cart-cleanup/cart-line-cleanup-fingerprint"
import {
  CartCleanupAction,
  CartCleanupDecision,
  CartReferenceCounts,
  CartSnapshot,
} from "../cart-cleanup/cart-line-cleanup-policy"
import {
  CartCleanupPlan,
  planCartCleanup,
} from "../cart-cleanup/cart-line-cleanup-service"
import { buildCartCleanupReport } from "../cart-cleanup/cart-line-cleanup-report"

/**
 * Cart Line Cleanup — tek cart'taki tek hedef satırı güvenli kaldırma.
 * VARSAYILAN: DRY-RUN (DB write 0). Gerçek commit yalnız CART_CLEANUP_COMMIT=true
 * + CART_CLEANUP_CONFIRM=<plan_fingerprint> ile ve plan DRY_RUN_READY ise yapılır.
 * RAW SQL YOK; silme Medusa public deleteLineItemsWorkflow ile yapılır (Store API
 * DELETE /store/carts/:id/line-items/:id ile aynı). Cart'taki DİĞER satırlar ve
 * cart'ın kendisi KORUNUR.
 */

const REPORTS_DIR = path.resolve(process.cwd(), "cart-cleanup-reports")
const LATEST_REPORT = path.join(REPORTS_DIR, "cart-line-cleanup-latest.json")

interface CartGraphRow {
  id: string
  completed_at?: string | null
  payment_collection?: {
    id?: string | null
    status?: string | null
    amount?: number | null
    captured_amount?: number | null
    authorized_amount?: number | null
    payment_sessions?: Array<{ id?: string | null; status?: string | null }> | null
  } | null
  items?: Array<{
    id?: string | null
    product_id?: string | null
    variant_id?: string | null
    quantity?: number | null
    unit_price?: number | null
    title?: string | null
  }> | null
}

export default async function cartLineCleanup({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const requestedCartId = (process.env.CART_CLEANUP_CART_ID ?? "").trim()
  const requestedLineItemId = (process.env.CART_CLEANUP_LINE_ITEM_ID ?? "").trim()
  if (!requestedCartId || !requestedLineItemId) {
    throw new Error(
      "[cart:cleanup] Fail-closed: CART_CLEANUP_CART_ID ve CART_CLEANUP_LINE_ITEM_ID zorunlu."
    )
  }
  if (!/^cart_[A-Za-z0-9]+$/.test(requestedCartId) || !/^cali_[A-Za-z0-9]+$/.test(requestedLineItemId)) {
    throw new Error("[cart:cleanup] Fail-closed: geçersiz cart/line item id biçimi.")
  }

  const commitEnabled = process.env.CART_CLEANUP_COMMIT === "true"
  const confirmToken = process.env.CART_CLEANUP_CONFIRM ?? null
  const mode: "dry-run" | "commit" = commitEnabled ? "commit" : "dry-run"
  const startedAt = new Date().toISOString()

  // ── Read-only: cart snapshot ──────────────────────────────────────────────
  const { data } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "completed_at",
      "payment_collection.id",
      "payment_collection.status",
      "payment_collection.amount",
      "payment_collection.captured_amount",
      "payment_collection.authorized_amount",
      "payment_collection.payment_sessions.id",
      "payment_collection.payment_sessions.status",
      "items.id",
      "items.product_id",
      "items.variant_id",
      "items.quantity",
      "items.unit_price",
      "items.title",
    ],
    filters: { id: requestedCartId },
  })
  const row = (data ?? [])[0] as CartGraphRow | undefined

  let snapshot: CartSnapshot | null = null
  let counts: CartReferenceCounts | null = null

  if (row) {
    const pc = row.payment_collection ?? null
    const items = (row.items ?? [])
      .filter((i) => typeof i.id === "string")
      .map((i) => ({
        id: i.id as string,
        product_id: i.product_id ?? null,
        variant_id: i.variant_id ?? null,
        quantity: typeof i.quantity === "number" ? i.quantity : null,
        unit_price: typeof i.unit_price === "number" ? i.unit_price : null,
        title: i.title ?? null,
      }))
    snapshot = {
      cart_id: row.id,
      completed_at: row.completed_at ?? null,
      payment_collection_exists: !!pc,
      payment_collection_status: pc?.status ?? null,
      payment_captured_amount: toNumber(pc?.captured_amount),
      payment_sessions: (pc?.payment_sessions ?? []).length,
      items,
    }
    const otherCount = items.filter((i) => i.id !== requestedLineItemId).length
    counts = {
      // Cart order'a dönmüşse completed_at dolu olur → order referansı 1 sayılır.
      order_reference_count: row.completed_at ? 1 : 0,
      total_line_items: items.length,
      other_line_items: otherCount,
    }
  }

  const plan = planCartCleanup({
    requestedCartId,
    requestedLineItemId,
    snapshot,
    counts,
  })

  let action: CartCleanupAction | null = plan.action
  let dbWrites = 0
  let finalDecision: CartCleanupDecision = plan.decision

  if (mode === "commit") {
    const exec = await runCommit(container, plan, snapshot, requestedLineItemId, confirmToken, logger)
    action = exec.action
    dbWrites = exec.dbWrites
    finalDecision = exec.decision
  }

  const finishedAt = new Date().toISOString()
  const runId = `clc_${Date.now().toString(36)}_${(plan.plan_fingerprint ?? "noplan").slice(0, 8)}`

  const report = buildCartCleanupReport({
    runId,
    startedAt,
    finishedAt,
    mode,
    snapshot,
    counts,
    plan,
    commitEnabled,
    dbWrites,
    finalDecision,
    action,
  })

  await writeReport(report)
  logSummary(logger, report)
}

async function runCommit(
  container: ExecArgs["container"],
  plan: CartCleanupPlan,
  snapshot: CartSnapshot | null,
  lineItemId: string,
  confirmToken: string | null,
  logger: { info: (m: string) => void }
): Promise<{ action: CartCleanupAction | null; dbWrites: number; decision: CartCleanupDecision }> {
  if (!snapshot) {
    throw new Error("[cart:cleanup] Fail-closed: cart bulunamadı. Yazım yapılmadı.")
  }
  // Hedef satır zaten yoksa → idempotent no-op (confirm gerekmez, yazım yok).
  if (plan.decision === "CART_CLEANUP_IDEMPOTENT_NOOP") {
    return { action: plan.action, dbWrites: 0, decision: "CART_CLEANUP_IDEMPOTENT_NOOP" }
  }
  if (plan.decision !== "CART_CLEANUP_DRY_RUN_READY" || !plan.plan_fingerprint) {
    throw new Error(
      `[cart:cleanup] Fail-closed: plan commit'e uygun değil (decision=${plan.decision}). Yazım yapılmadı.`
    )
  }
  if (!isCartConfirmationValid(confirmToken, plan.plan_fingerprint)) {
    throw new Error(
      "[cart:cleanup] Fail-closed: CART_CLEANUP_CONFIRM plan_fingerprint ile eşleşmiyor. Yazım yapılmadı."
    )
  }

  const action: CartCleanupAction = { ...plan.action!, detail: { ...plan.action!.detail } }
  await deleteLineItemsWorkflow(container).run({
    input: { cart_id: snapshot.cart_id, ids: [lineItemId] },
  })
  action.executed = true
  action.db_writes = 1
  logger.info(`[cart:cleanup] commit yürütüldü — line item kaldırıldı: ${lineItemId}`)
  return { action, dbWrites: 1, decision: "CART_CLEANUP_COMMITTED" }
}

async function writeReport(report: ReturnType<typeof buildCartCleanupReport>): Promise<void> {
  await fs.mkdir(REPORTS_DIR, { recursive: true })
  const stamp = report.finished_at.replace(/[:.]/g, "-")
  const fp = report.plan_fingerprint ?? "noplan"
  const json = JSON.stringify(report, null, 2)
  await fs.writeFile(path.join(REPORTS_DIR, `cart-line-cleanup-${stamp}-${fp}.json`), json, "utf-8")
  await fs.writeFile(LATEST_REPORT, json, "utf-8")
}

function logSummary(
  logger: { info: (m: string) => void; warn: (m: string) => void },
  report: ReturnType<typeof buildCartCleanupReport>
): void {
  logger.info("──────────── CART LINE CLEANUP ÖZET ────────────")
  logger.info(
    `mode=${report.mode} decision=${report.final_decision} requested=${report.allowlist_result.requested_count} matched=${report.allowlist_result.matched_count}`
  )
  logger.info(
    `target_present=${report.gate_results.target_present} identity_ok=${report.gate_results.identity_ok} safety_ok=${report.gate_results.safety_ok} blockers=[${report.gate_results.safety_blockers.join(",")}]`
  )
  logger.info(
    `cart_completed=${report.gate_results.cart_completed} payment_captured=${report.gate_results.payment_captured} order_refs=${report.gate_results.order_reference_count} preserved_lines=${report.preserved_line_item_ids.length}`
  )
  logger.info(`db_writes=${report.db_writes} plan_fingerprint=${report.plan_fingerprint ?? "-"}`)
  if (report.planned_action) {
    const a = report.planned_action
    logger.info(`  - ${a.action}: status=${a.status} executed=${a.executed} db_writes=${a.db_writes}`)
  }
  if (report.errors.length > 0) report.errors.forEach((e) => logger.warn(`[cart:cleanup] error: ${e}`))
  if (report.mode === "dry-run" && report.commit_command) {
    logger.info(`Commit komutu (çalıştırılmadı): ${report.commit_command}`)
  }
  logger.info("Rapor: cart-cleanup-reports/cart-line-cleanup-latest.json")
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return 0
}
