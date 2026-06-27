import { promises as fs } from "fs"
import path from "path"

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { deletePaymentSessionsWorkflow } from "@medusajs/medusa/core-flows"

import { normalizeMoney } from "../checkout-test/money"
import { isPartialCartConfirmationValid } from "../partial-cart-cleanup/partial-cart-fingerprint"
import {
  PartialCartAction,
  PartialCartDecision,
  PartialCartSnapshot,
} from "../partial-cart-cleanup/partial-cart-policy"
import {
  PartialCartPlan,
  planPartialCartCleanup,
} from "../partial-cart-cleanup/partial-cart-service"
import { buildPartialCartReport } from "../partial-cart-cleanup/partial-cart-report"

/**
 * Partial Cart Cleanup — tek abandoned test cart'ı güvenli SOFT-DELETE.
 * VARSAYILAN: DRY-RUN (DB write 0). Commit yalnız PARTIAL_CART_CLEANUP_COMMIT=true
 * + PARTIAL_CART_CLEANUP_CONFIRM=<plan_fingerprint> ile ve plan DRY_RUN_READY ise.
 * RAW SQL YOK; soft-delete cart modül servisi, session delete public workflow ile.
 * Order/inventory/payment-capture'a dokunulmaz; hard delete yapılmaz.
 */

const REPORTS_DIR = path.resolve(process.cwd(), "partial-cart-reports")
const LATEST_REPORT = path.join(REPORTS_DIR, "partial-cart-cleanup-latest.json")

type QueryGraph = { graph: (args: unknown, options?: unknown) => Promise<{ data?: unknown[] }> }

export default async function partialCartCleanup({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph

  const requestedCartId = (process.env.PARTIAL_CART_CLEANUP_CART_ID ?? "").trim()
  if (!requestedCartId) {
    throw new Error("[partial-cart:cleanup] Fail-closed: PARTIAL_CART_CLEANUP_CART_ID zorunlu.")
  }
  if (!/^cart_[A-Za-z0-9]+$/.test(requestedCartId)) {
    throw new Error("[partial-cart:cleanup] Fail-closed: geçersiz cart id biçimi.")
  }

  const commitEnabled = process.env.PARTIAL_CART_CLEANUP_COMMIT === "true"
  const confirmToken = process.env.PARTIAL_CART_CLEANUP_CONFIRM ?? null
  const mode: "dry-run" | "commit" = commitEnabled ? "commit" : "dry-run"
  const startedAt = new Date().toISOString()

  const snapshot = await collectSnapshot(query, requestedCartId)
  const plan = planPartialCartCleanup(requestedCartId, snapshot)

  let actions: PartialCartAction[] = plan.actions
  let dbWrites = 0
  let finalDecision: PartialCartDecision = plan.decision

  if (mode === "commit") {
    const exec = await runCommit(container, plan, snapshot, confirmToken, logger)
    actions = exec.actions
    dbWrites = exec.dbWrites
    finalDecision = exec.decision
  }

  const finishedAt = new Date().toISOString()
  const runId = `pcc_${Date.now().toString(36)}_${(plan.plan_fingerprint ?? "noplan").slice(0, 8)}`

  const report = buildPartialCartReport({
    runId, startedAt, finishedAt, mode, snapshot, plan, commitEnabled, dbWrites, finalDecision, actions,
  })

  await writeReport(report)
  logSummary(logger, report)
}

async function runCommit(
  container: ExecArgs["container"],
  plan: PartialCartPlan,
  snapshot: PartialCartSnapshot | null,
  confirmToken: string | null,
  logger: { info: (m: string) => void }
): Promise<{ actions: PartialCartAction[]; dbWrites: number; decision: PartialCartDecision }> {
  if (!snapshot) {
    throw new Error("[partial-cart:cleanup] Fail-closed: cart bulunamadı. Yazım yapılmadı.")
  }
  if (plan.decision === "PARTIAL_CART_CLEANUP_IDEMPOTENT_NOOP") {
    return { actions: plan.actions, dbWrites: 0, decision: "PARTIAL_CART_CLEANUP_IDEMPOTENT_NOOP" }
  }
  if (plan.decision !== "PARTIAL_CART_CLEANUP_DRY_RUN_READY" || !plan.plan_fingerprint) {
    throw new Error(`[partial-cart:cleanup] Fail-closed: plan commit'e uygun değil (decision=${plan.decision}).`)
  }
  if (!isPartialCartConfirmationValid(confirmToken, plan.plan_fingerprint)) {
    throw new Error("[partial-cart:cleanup] Fail-closed: CONFIRM plan_fingerprint ile eşleşmiyor. Yazım yapılmadı.")
  }

  const actions = plan.actions.map((a) => ({ ...a, detail: { ...a.detail } }))
  let dbWrites = 0

  for (const action of actions) {
    if (action.status === "no_op") continue
    if (action.action === "PAYMENT_SESSION_DELETE" && snapshot.payment_session_id) {
      await deletePaymentSessionsWorkflow(container).run({
        input: { ids: [snapshot.payment_session_id] },
      })
      action.executed = true
      action.db_writes = 1
      dbWrites++
    } else if (action.action === "CART_SOFT_DELETE") {
      const cartModule = container.resolve(Modules.CART) as {
        softDeleteCarts: (ids: string[]) => Promise<unknown>
      }
      await cartModule.softDeleteCarts([snapshot.cart_id])
      action.executed = true
      action.db_writes = 1
      dbWrites++
    }
  }

  logger.info(`[partial-cart:cleanup] commit yürütüldü — db_writes=${dbWrites}`)
  return { actions, dbWrites, decision: "PARTIAL_CART_CLEANUP_COMMITTED" }
}

async function collectSnapshot(
  query: QueryGraph,
  cartId: string
): Promise<PartialCartSnapshot | null> {
  const { data } = await query.graph({
    entity: "cart",
    fields: [
      "id", "deleted_at", "completed_at", "email",
      "items.id", "items.variant_id", "items.quantity", "items.unit_price",
      "shipping_methods.shipping_option_id", "shipping_methods.amount", "shipping_methods.total",
      "item_total", "shipping_total", "total",
      "payment_collection.id", "payment_collection.captured_amount",
      "payment_collection.payment_sessions.id", "payment_collection.payment_sessions.status", "payment_collection.payment_sessions.provider_id",
    ],
    filters: { id: cartId },
  })
  const c = (data ?? [])[0] as any
  if (!c) {
    return {
      cart_id: cartId, found: false, deleted_at: null, completed_at: null, email: null,
      item_count: 0, line: null, shipping_option_id: null, shipping_total: null, total: null,
      payment_collection_id: null, payment_session_id: null, payment_session_status: null,
      payment_captured_amount: 0, payment_provider_id: null, order_reference_count: 0,
      inventory_reservation_count: 0,
    }
  }
  const item = (c.items ?? [])[0] ?? null
  const sm = (c.shipping_methods ?? [])[0] ?? null
  const ps = (c.payment_collection?.payment_sessions ?? [])[0] ?? null
  const lineItemId = item?.id ?? null
  const reservations = await reservationCount(query, lineItemId)

  return {
    cart_id: c.id,
    found: true,
    deleted_at: c.deleted_at ?? null,
    completed_at: c.completed_at ?? null,
    email: c.email ?? null,
    item_count: (c.items ?? []).length,
    line: item ? { variant_id: item.variant_id, quantity: normalizeMoney(item.quantity), unit_price: normalizeMoney(item.unit_price) } : null,
    shipping_option_id: sm?.shipping_option_id ?? null,
    shipping_total: normalizeMoney(c.shipping_total),
    total: normalizeMoney(c.total),
    payment_collection_id: c.payment_collection?.id ?? null,
    payment_session_id: ps?.id ?? null,
    payment_session_status: ps?.status ?? null,
    payment_captured_amount: normalizeMoney(c.payment_collection?.captured_amount) ?? 0,
    payment_provider_id: ps?.provider_id ?? null,
    order_reference_count: c.completed_at ? 1 : 0,
    inventory_reservation_count: reservations,
  }
}

async function reservationCount(query: QueryGraph, lineItemId: string | null): Promise<number> {
  if (!lineItemId) return 0
  try {
    const { data } = await query.graph({
      entity: "reservation_item",
      fields: ["id", "line_item_id"],
      filters: { line_item_id: lineItemId },
    })
    return (data ?? []).length
  } catch {
    return 0
  }
}

async function writeReport(report: ReturnType<typeof buildPartialCartReport>): Promise<void> {
  await fs.mkdir(REPORTS_DIR, { recursive: true })
  const stamp = report.finished_at.replace(/[:.]/g, "-")
  const fp = report.plan_fingerprint ?? "noplan"
  const json = JSON.stringify(report, null, 2)
  await fs.writeFile(path.join(REPORTS_DIR, `partial-cart-cleanup-${stamp}-${fp}.json`), json, "utf-8")
  await fs.writeFile(LATEST_REPORT, json, "utf-8")
}

function logSummary(
  logger: { info: (m: string) => void; warn: (m: string) => void },
  report: ReturnType<typeof buildPartialCartReport>
): void {
  logger.info("──────────── PARTIAL CART CLEANUP ÖZET ────────────")
  logger.info(`mode=${report.mode} decision=${report.final_decision} cart=${report.cart_id}`)
  logger.info(
    `identity_ok=${report.gate_results.identity_ok} safety_ok=${report.gate_results.safety_ok} blockers=[${report.gate_results.safety_blockers.join(",")}] db_writes=${report.db_writes}`
  )
  for (const a of report.planned_actions) {
    logger.info(`  - ${a.action}: ${a.status} executed=${a.executed} db_writes=${a.db_writes}`)
  }
  logger.info(`strategy: ${report.cleanup_strategy}`)
  if (report.errors.length > 0) report.errors.forEach((e) => logger.warn(`[partial-cart:cleanup] ${e}`))
  if (report.mode === "dry-run" && report.commit_command) {
    logger.info(`Commit komutu (çalıştırılmadı): ${report.commit_command}`)
  }
  logger.info("Rapor: partial-cart-reports/partial-cart-cleanup-latest.json")
}
