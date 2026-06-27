/**
 * Test Order Cancel — deterministik plan fingerprint (SAF).
 */

import { createHash } from "crypto"

export interface TestOrderCancelFingerprintPayload {
  policy_version: number
  order_id: string
  display_id: number | null
  email: string | null
  has_test_marker: boolean
  order_status: string | null
  payment_status: string | null
  authorized_amount: number
  captured_amount: number
  refund_amount: number
  order_total: number | null
  variant_id: string | null
  sku: string | null
  quantity: number | null
  unit_price: number | null
  shipping_method_name: string | null
  shipping_amount: number | null
  reservation_ids: string[]
  reservation_quantity: number
  inventory_stocked: number | null
  inventory_reserved: number | null
  fulfillment_count: number
  return_count: number
  claim_count: number
  exchange_count: number
  planned_actions: Array<{ action: string; status: string }>
}

function sha16(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16)
}

export function computeTestOrderCancelFingerprint(
  payload: TestOrderCancelFingerprintPayload
): string {
  const canonical = JSON.stringify({
    policy_version: payload.policy_version,
    order_id: payload.order_id,
    display_id: payload.display_id,
    email: payload.email,
    has_test_marker: payload.has_test_marker,
    order_status: payload.order_status,
    payment_status: payload.payment_status,
    authorized_amount: payload.authorized_amount,
    captured_amount: payload.captured_amount,
    refund_amount: payload.refund_amount,
    order_total: payload.order_total,
    variant_id: payload.variant_id,
    sku: payload.sku,
    quantity: payload.quantity,
    unit_price: payload.unit_price,
    shipping_method_name: payload.shipping_method_name,
    shipping_amount: payload.shipping_amount,
    reservation_ids: [...payload.reservation_ids].sort(),
    reservation_quantity: payload.reservation_quantity,
    inventory_stocked: payload.inventory_stocked,
    inventory_reserved: payload.inventory_reserved,
    fulfillment_count: payload.fulfillment_count,
    return_count: payload.return_count,
    claim_count: payload.claim_count,
    exchange_count: payload.exchange_count,
    planned_actions: payload.planned_actions.map((a) => ({ action: a.action, status: a.status })),
  })
  return sha16(canonical)
}

export function isTestOrderCancelConfirmationValid(
  confirmToken: string | null | undefined,
  planFingerprint: string
): boolean {
  if (!confirmToken) return false
  return confirmToken.trim() === planFingerprint
}
