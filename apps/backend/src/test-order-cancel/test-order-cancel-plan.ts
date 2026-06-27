/**
 * Test Order Cancel — SAF plan mantığı (IO yok, deterministik).
 *
 * Allowlist → kimlik (authoritative total) → safety → cancel aksiyonları.
 * Fulfillment/return/capture/refund varsa fail-closed. Hard delete YOK.
 */

import {
  CancelAction,
  ExpectedOrder,
  TestOrderSnapshot,
} from "./test-order-cancel-policy"

export interface AllowlistResult {
  requested_order_id: string
  allowlisted_order_id: string
  requested_count: number
  matched_count: number
  ok: boolean
  reason: string | null
}

export function evaluateAllowlist(
  requestedOrderId: string,
  allowlistedOrderId: string,
  found: boolean
): AllowlistResult {
  const idOk = requestedOrderId === allowlistedOrderId
  let reason: string | null = null
  if (!idOk) reason = "requested_order_not_allowlisted"
  else if (!found) reason = "order_not_found"
  return {
    requested_order_id: requestedOrderId,
    allowlisted_order_id: allowlistedOrderId,
    requested_count: idOk ? 1 : 0,
    matched_count: found ? 1 : 0,
    ok: idOk && found,
    reason,
  }
}

export interface IdentityResult {
  ok: boolean
  mismatches: string[]
}

export function evaluateIdentity(
  snap: TestOrderSnapshot,
  expected: ExpectedOrder
): IdentityResult {
  const m: string[] = []
  if (snap.order_id !== expected.order_id) m.push("order_id")
  if (snap.display_id !== expected.display_id) m.push("display_id")
  if (snap.email !== expected.email) m.push("email")
  if (snap.currency !== expected.currency) m.push("currency")
  // authoritative total (ham item_total=0 artefaktı DEĞİL)
  if (snap.authoritative_total !== expected.total) m.push("authoritative_total")
  if (snap.item_count !== expected.item_count) m.push("item_count")
  if (!snap.line) m.push("line_missing")
  else {
    if (snap.line.variant_id !== expected.variant_id) m.push("variant_id")
    if (snap.line.sku !== expected.sku) m.push("sku")
    if (snap.line.quantity !== expected.quantity) m.push("quantity")
    if (snap.line.unit_price !== expected.unit_price) m.push("unit_price")
  }
  if (snap.shipping_method_name !== expected.shipping_method_name) m.push("shipping_method_name")
  if (snap.shipping_amount !== expected.shipping_amount) m.push("shipping_amount")
  if (snap.payment_provider_id !== expected.payment_provider_id) m.push("payment_provider_id")
  if (snap.authorized_amount !== expected.authorized_amount) m.push("authorized_amount")
  if (snap.captured_amount !== expected.captured_amount) m.push("captured_amount")
  if (snap.reservation_ids.length !== expected.reservation_count) m.push("reservation_count")
  if (snap.reservation_quantity !== expected.reservation_quantity) m.push("reservation_quantity")
  return { ok: m.length === 0, mismatches: m }
}

export interface SafetyResult {
  ok: boolean
  blockers: string[]
}

export function evaluateSafety(snap: TestOrderSnapshot): SafetyResult {
  const b: string[] = []
  if (snap.deleted_at !== null) b.push("order_deleted")
  if (snap.canceled_at !== null || snap.status === "canceled") b.push("already_canceled")
  if (snap.status === "completed") b.push("order_completed")
  if (snap.fulfillment_count > 0) b.push("fulfillment_exists")
  if (snap.return_count > 0) b.push("return_exists")
  if (snap.exchange_count > 0) b.push("exchange_exists")
  if (snap.claim_count > 0) b.push("claim_exists")
  if (snap.captured_amount > 0) b.push("payment_captured")
  if (snap.refund_amount > 0) b.push("refund_exists")
  if (snap.reservation_ids.length !== 1) b.push("reservation_count_not_1")
  if (
    snap.reservation_inventory_item_id !== null &&
    snap.inventory_item_id !== null &&
    snap.reservation_inventory_item_id !== snap.inventory_item_id
  ) {
    b.push("reservation_wrong_inventory_item")
  }
  if (!snap.has_test_marker) b.push("missing_test_marker")
  if (snap.active_partial_cart_count > 0) b.push("active_partial_cart_exists")
  if (snap.other_active_test_order_count > 0) b.push("other_active_test_order_exists")
  return { ok: b.length === 0, blockers: b }
}

/**
 * Aksiyonlar: tek `cancelOrderWorkflow` çağrısı ORDER_CANCEL'i yürütür ve
 * RESERVATION_RELEASE + PAYMENT_AUTHORIZATION_CANCEL'i WORKFLOW İÇİNDE yapar
 * (ayrı manuel writer YOK). Captured 0 → refund yok.
 */
export function buildActions(snap: TestOrderSnapshot): CancelAction[] {
  return [
    {
      action: "ORDER_CANCEL",
      status: "planned",
      executed: false,
      workflow_internal: false,
      detail: {
        workflow: "cancelOrderWorkflow",
        order_id: snap.order_id,
        expected_after_status: "canceled",
        order_deleted: false,
        note: "cancel-not-delete; order ve audit korunur.",
      },
    },
    {
      action: "RESERVATION_RELEASE",
      status: "planned",
      executed: false,
      workflow_internal: true,
      detail: {
        reservation_ids: snap.reservation_ids,
        reservation_quantity: snap.reservation_quantity,
        expected_reserved_after: 0,
        expected_stocked_after: snap.inventory_stocked,
        note: "cancelOrderWorkflow içinde deleteReservationsByLineItemsStep ile.",
      },
    },
    {
      action: "PAYMENT_AUTHORIZATION_CANCEL",
      status: "planned",
      executed: false,
      workflow_internal: true,
      detail: {
        authorized_amount: snap.authorized_amount,
        captured_amount: snap.captured_amount,
        refund_required: snap.captured_amount > 0,
        note: "uncaptured authorized payment cancelPaymentStep ile iptal; captured 0 → refund YOK.",
      },
    },
  ]
}
