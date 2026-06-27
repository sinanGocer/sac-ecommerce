import { promises as fs } from "fs"
import path from "path"

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { cancelOrderWorkflow } from "@medusajs/medusa/core-flows"

import { normalizeMoney } from "../checkout-test/money"
import { isTestOrderCancelConfirmationValid } from "../test-order-cancel/test-order-cancel-fingerprint"
import {
  CancelAction,
  TestOrderCancelDecision,
  TestOrderSnapshot,
} from "../test-order-cancel/test-order-cancel-policy"
import {
  planTestOrderCancel,
  TestOrderCancelPlan,
} from "../test-order-cancel/test-order-cancel-service"
import { buildTestOrderCancelReport } from "../test-order-cancel/test-order-cancel-report"

/**
 * Test Order Cancel — kontrollü test siparişini Medusa cancelOrderWorkflow ile
 * iptal. VARSAYILAN: DRY-RUN. Commit yalnız TEST_ORDER_CANCEL_COMMIT=true +
 * TEST_ORDER_CANCEL_CONFIRM=<plan_fingerprint> ile ve plan DRY_RUN_READY ise.
 * RAW SQL YOK; hard delete YOK; cancel-not-delete.
 */

const REPORTS_DIR = path.resolve(process.cwd(), "test-order-cancel-reports")
const LATEST_REPORT = path.join(REPORTS_DIR, "test-order-cancel-latest.json")
const TEST_EMAIL = "checkout-e2e-test@invalid.example"

type QueryGraph = { graph: (args: unknown, options?: unknown) => Promise<{ data?: unknown[] }> }

export default async function testOrderCancel({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph

  const requestedOrderId = (process.env.TEST_ORDER_CANCEL_ORDER_ID ?? "").trim()
  if (!requestedOrderId) {
    throw new Error("[test-order:cancel] Fail-closed: TEST_ORDER_CANCEL_ORDER_ID zorunlu.")
  }
  if (!/^order_[A-Za-z0-9]+$/.test(requestedOrderId)) {
    throw new Error("[test-order:cancel] Fail-closed: geçersiz order id biçimi.")
  }

  const commitEnabled = process.env.TEST_ORDER_CANCEL_COMMIT === "true"
  const confirmToken = process.env.TEST_ORDER_CANCEL_CONFIRM ?? null
  const mode: "dry-run" | "commit" = commitEnabled ? "commit" : "dry-run"
  const startedAt = new Date().toISOString()

  const snapshot = await collectSnapshot(query, requestedOrderId)
  const plan = planTestOrderCancel(requestedOrderId, snapshot)

  let actions: CancelAction[] = plan.actions
  let actualMutations = 0
  let dbWrites = 0
  let finalDecision: TestOrderCancelDecision = plan.decision

  if (mode === "commit") {
    const exec = await runCommit(container, plan, snapshot, confirmToken, logger)
    actions = exec.actions
    actualMutations = exec.actualMutations
    dbWrites = exec.dbWrites
    finalDecision = exec.decision
  }

  const finishedAt = new Date().toISOString()
  const runId = `toc_${Date.now().toString(36)}_${(plan.plan_fingerprint ?? "noplan").slice(0, 8)}`

  const report = buildTestOrderCancelReport({
    runId, startedAt, finishedAt, mode, snapshot, plan, commitEnabled, actualMutations, dbWrites, finalDecision, actions,
  })

  await writeReport(report)
  logSummary(logger, report)
}

async function runCommit(
  container: ExecArgs["container"],
  plan: TestOrderCancelPlan,
  snapshot: TestOrderSnapshot | null,
  confirmToken: string | null,
  logger: { info: (m: string) => void }
): Promise<{ actions: CancelAction[]; actualMutations: number; dbWrites: number; decision: TestOrderCancelDecision }> {
  if (!snapshot) {
    throw new Error("[test-order:cancel] Fail-closed: order bulunamadı. Yazım yapılmadı.")
  }
  if (plan.decision === "TEST_ORDER_CANCEL_IDEMPOTENT_NOOP") {
    return { actions: plan.actions, actualMutations: 0, dbWrites: 0, decision: "TEST_ORDER_CANCEL_IDEMPOTENT_NOOP" }
  }
  if (plan.decision !== "TEST_ORDER_CANCEL_DRY_RUN_READY" || !plan.plan_fingerprint) {
    throw new Error(`[test-order:cancel] Fail-closed: plan commit'e uygun değil (decision=${plan.decision}).`)
  }
  if (!isTestOrderCancelConfirmationValid(confirmToken, plan.plan_fingerprint)) {
    throw new Error("[test-order:cancel] Fail-closed: CONFIRM plan_fingerprint ile eşleşmiyor. Yazım yapılmadı.")
  }

  const actions = plan.actions.map((a) => ({ ...a, detail: { ...a.detail } }))
  try {
    // Tek workflow çağrısı: order cancel + reservation release + uncaptured
    // payment cancel WORKFLOW İÇİNDE. captured 0 → refund yok.
    await cancelOrderWorkflow(container).run({ input: { order_id: snapshot.order_id } as any })
    for (const a of actions) a.executed = true
    logger.info(`[test-order:cancel] commit yürütüldü — cancelOrderWorkflow(${snapshot.order_id})`)
    return { actions, actualMutations: 1, dbWrites: 1, decision: "TEST_ORDER_CANCEL_COMMITTED" }
  } catch (e) {
    logger.info(`[test-order:cancel] workflow hata: ${e instanceof Error ? e.message : String(e)}`)
    return { actions, actualMutations: 0, dbWrites: 0, decision: "TEST_ORDER_CANCEL_PARTIAL_FAILURE" }
  }
}

async function collectSnapshot(
  query: QueryGraph,
  orderId: string
): Promise<TestOrderSnapshot | null> {
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id", "display_id", "email", "status", "canceled_at", "deleted_at", "currency_code", "metadata",
      "summary.current_order_total", "summary.original_order_total", "summary.accounting_total",
      "items.id", "items.variant_id", "items.variant_sku", "items.quantity", "items.detail.quantity", "items.unit_price",
      "shipping_methods.name", "shipping_methods.amount",
      "fulfillments.id", "fulfillments.canceled_at",
      "payment_collections.authorized_amount", "payment_collections.captured_amount", "payment_collections.refunded_amount", "payment_collections.status",
      "payment_collections.payments.captured_at",
    ],
    filters: { id: orderId },
  })
  const o = (data ?? [])[0] as any
  if (!o) {
    return {
      order_id: orderId, found: false, deleted_at: null, canceled_at: null, status: null,
      display_id: null, email: null, currency: null, authoritative_total: null, item_count: 0,
      line: null, shipping_method_name: null, shipping_amount: null, payment_provider_id: null,
      authorized_amount: 0, captured_amount: 0, refund_amount: 0, payment_status: null,
      fulfillment_count: 0, return_count: 0, exchange_count: 0, claim_count: 0, has_test_marker: false,
      reservation_ids: [], reservation_quantity: 0, reservation_inventory_item_id: null,
      inventory_item_id: null, inventory_stocked: null, inventory_reserved: null,
      active_partial_cart_count: 0, other_active_test_order_count: 0,
    }
  }

  const item = (o.items ?? [])[0] ?? null
  const sm = (o.shipping_methods ?? [])[0] ?? null
  const pc = (o.payment_collections ?? [])[0] ?? null
  const summary = o.summary ?? {}
  const authoritative =
    normalizeMoney(summary.current_order_total) ??
    normalizeMoney(summary.original_order_total) ??
    normalizeMoney(summary.accounting_total)

  // Shipping option provider — payment provider'ı session/collection üzerinden değil,
  // ödeme provider'ı pp_system_default doğrulamak için payment session provider:
  let paymentProvider: string | null = null
  try {
    const { data: ps } = await query.graph({
      entity: "payment_collection",
      fields: ["id", "payment_sessions.provider_id"],
      filters: { id: pc?.id },
    })
    paymentProvider = (((ps ?? [])[0] as any)?.payment_sessions ?? [])[0]?.provider_id ?? null
  } catch {
    paymentProvider = null
  }

  // Counts (returns/exchanges/claims) — defansif ayrı sorgu.
  const returnCount = await countByOrder(query, "return", orderId)
  const exchangeCount = await countByOrder(query, "order_exchange", orderId)
  const claimCount = await countByOrder(query, "order_claim", orderId)

  // Reservation + inventory (line item üzerinden).
  const lineItemId = item?.id ?? null
  const res = await reservations(query, lineItemId)
  const inv = await inventoryLevels(query, item?.variant_id ?? null)

  const fulfillments = (o.fulfillments ?? []) as Array<any>
  const activeFulfillments = fulfillments.filter((f) => f.canceled_at == null).length

  const dup = await duplicateContext(query, orderId)

  return {
    order_id: o.id,
    found: true,
    deleted_at: o.deleted_at ?? null,
    canceled_at: o.canceled_at ?? null,
    status: o.status ?? null,
    display_id: typeof o.display_id === "number" ? o.display_id : Number(o.display_id ?? NaN) || null,
    email: o.email ?? null,
    currency: o.currency_code ?? null,
    authoritative_total: authoritative,
    item_count: (o.items ?? []).length,
    line: item
      ? { variant_id: item.variant_id, sku: item.variant_sku, quantity: normalizeMoney(item.quantity), unit_price: normalizeMoney(item.unit_price) }
      : null,
    shipping_method_name: sm?.name ?? null,
    shipping_amount: normalizeMoney(sm?.amount),
    payment_provider_id: paymentProvider,
    authorized_amount: normalizeMoney(pc?.authorized_amount) ?? 0,
    captured_amount: normalizeMoney(pc?.captured_amount) ?? 0,
    refund_amount: normalizeMoney(pc?.refunded_amount) ?? 0,
    payment_status: pc?.status ?? null,
    fulfillment_count: activeFulfillments,
    return_count: returnCount,
    exchange_count: exchangeCount,
    claim_count: claimCount,
    has_test_marker: (o.metadata ?? {})?.test_order === true,
    reservation_ids: res.ids,
    reservation_quantity: res.quantity,
    reservation_inventory_item_id: res.inventory_item_id,
    inventory_item_id: inv.inventory_item_id,
    inventory_stocked: inv.stocked,
    inventory_reserved: inv.reserved,
    active_partial_cart_count: dup.partial,
    other_active_test_order_count: dup.otherOrders,
  }
}

async function countByOrder(query: QueryGraph, entity: string, orderId: string): Promise<number> {
  try {
    const { data } = await query.graph({ entity, fields: ["id"], filters: { order_id: orderId } })
    return (data ?? []).length
  } catch {
    return 0
  }
}

async function reservations(
  query: QueryGraph,
  lineItemId: string | null
): Promise<{ ids: string[]; quantity: number; inventory_item_id: string | null }> {
  if (!lineItemId) return { ids: [], quantity: 0, inventory_item_id: null }
  try {
    const { data } = await query.graph({
      entity: "reservation_item",
      fields: ["id", "quantity", "inventory_item_id"],
      filters: { line_item_id: lineItemId },
    })
    const rows = (data ?? []) as Array<any>
    return {
      ids: rows.map((r) => r.id).filter(Boolean),
      quantity: rows.reduce((s, r) => s + (normalizeMoney(r.quantity) ?? 0), 0),
      inventory_item_id: rows[0]?.inventory_item_id ?? null,
    }
  } catch {
    return { ids: [], quantity: 0, inventory_item_id: null }
  }
}

async function inventoryLevels(
  query: QueryGraph,
  variantId: string | null
): Promise<{ inventory_item_id: string | null; stocked: number | null; reserved: number | null }> {
  if (!variantId) return { inventory_item_id: null, stocked: null, reserved: null }
  try {
    const { data } = await query.graph({
      entity: "product_variant_inventory_items",
      fields: [
        "inventory_item_id",
        "inventory.location_levels.stocked_quantity",
        "inventory.location_levels.reserved_quantity",
      ],
      filters: { variant_id: [variantId] },
    })
    const link = (data ?? [])[0] as any
    const lvl = link?.inventory?.location_levels?.[0]
    return {
      inventory_item_id: link?.inventory_item_id ?? null,
      stocked: lvl ? normalizeMoney(lvl.stocked_quantity) : null,
      reserved: lvl ? normalizeMoney(lvl.reserved_quantity) : null,
    }
  } catch {
    return { inventory_item_id: null, stocked: null, reserved: null }
  }
}

async function duplicateContext(
  query: QueryGraph,
  orderId: string
): Promise<{ partial: number; otherOrders: number }> {
  let partial = 0
  let otherOrders = 0
  try {
    const { data } = await query.graph({ entity: "cart", fields: ["id", "completed_at", "deleted_at"], filters: { email: TEST_EMAIL } })
    partial = ((data ?? []) as Array<any>).filter((c) => c.completed_at == null && c.deleted_at == null).length
  } catch {
    partial = 0
  }
  try {
    const { data } = await query.graph({ entity: "order", fields: ["id", "status", "canceled_at"], filters: { email: TEST_EMAIL } })
    otherOrders = ((data ?? []) as Array<any>).filter(
      (o) => o.id !== orderId && o.canceled_at == null && o.status !== "canceled"
    ).length
  } catch {
    otherOrders = 0
  }
  return { partial, otherOrders }
}

async function writeReport(report: ReturnType<typeof buildTestOrderCancelReport>): Promise<void> {
  await fs.mkdir(REPORTS_DIR, { recursive: true })
  const stamp = report.finished_at.replace(/[:.]/g, "-")
  const fp = report.plan_fingerprint ?? "noplan"
  const json = JSON.stringify(report, null, 2)
  await fs.writeFile(path.join(REPORTS_DIR, `test-order-cancel-${stamp}-${fp}.json`), json, "utf-8")
  await fs.writeFile(LATEST_REPORT, json, "utf-8")
}

function logSummary(
  logger: { info: (m: string) => void; warn: (m: string) => void },
  report: ReturnType<typeof buildTestOrderCancelReport>
): void {
  logger.info("──────────── TEST ORDER CANCEL ÖZET ────────────")
  logger.info(`mode=${report.mode} decision=${report.final_decision} order=${report.order_id}`)
  logger.info(
    `safety_ok=${report.safety_checks.ok} blockers=[${report.safety_checks.blockers.join(",")}] estimated_mutations=${report.estimated_mutations} actual_mutations=${report.actual_mutations} db_writes=${report.db_writes}`
  )
  for (const a of report.planned_actions) {
    logger.info(`  - ${a.action}: ${a.status} executed=${a.executed} workflow_internal=${a.workflow_internal}`)
  }
  if (report.errors.length > 0) report.errors.forEach((e) => logger.warn(`[test-order:cancel] ${e}`))
  if (report.mode === "dry-run" && report.execution_command) {
    logger.info(`Commit komutu (çalıştırılmadı): ${report.execution_command}`)
  }
  logger.info("Rapor: test-order-cancel-reports/test-order-cancel-latest.json")
}
