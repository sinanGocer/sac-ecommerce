/**
 * Partial Cart Cleanup — deterministik plan fingerprint (SAF).
 */

import { createHash } from "crypto"

export interface PartialCartFingerprintPayload {
  policy_version: number
  cart_id: string
  email: string | null
  variant_id: string | null
  quantity: number | null
  unit_price: number | null
  shipping_option_id: string | null
  shipping_total: number | null
  total: number | null
  payment_provider_id: string | null
  payment_session_id: string | null
  deleted_at: string | null
  order_reference_count: number
  inventory_reservation_count: number
  planned_actions: Array<{ action: string; status: string }>
}

function sha16(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16)
}

export function computePartialCartFingerprint(
  payload: PartialCartFingerprintPayload
): string {
  const canonical = JSON.stringify({
    policy_version: payload.policy_version,
    cart_id: payload.cart_id,
    email: payload.email,
    variant_id: payload.variant_id,
    quantity: payload.quantity,
    unit_price: payload.unit_price,
    shipping_option_id: payload.shipping_option_id,
    shipping_total: payload.shipping_total,
    total: payload.total,
    payment_provider_id: payload.payment_provider_id,
    payment_session_id: payload.payment_session_id,
    deleted_at: payload.deleted_at,
    order_reference_count: payload.order_reference_count,
    inventory_reservation_count: payload.inventory_reservation_count,
    planned_actions: payload.planned_actions.map((a) => ({ action: a.action, status: a.status })),
  })
  return sha16(canonical)
}

export function isPartialCartConfirmationValid(
  confirmToken: string | null | undefined,
  planFingerprint: string
): boolean {
  if (!confirmToken) return false
  return confirmToken.trim() === planFingerprint
}
