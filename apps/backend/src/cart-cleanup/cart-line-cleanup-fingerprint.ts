/**
 * Cart Line Cleanup — deterministik plan fingerprint (SAF).
 *
 * Cart içeriği veya hedef satır durumu değişirse fingerprint değişir → eski
 * commit confirm token'ı reddedilir. Commit token'ı yalnız plan_fingerprint'tir.
 */

import { createHash } from "crypto"

export interface CartCleanupFingerprintPayload {
  policy_version: number
  cart_id: string
  line_item_id: string
  product_id: string | null
  variant_id: string | null
  quantity: number | null
  unit_price: number | null
  cart_completed: boolean
  order_reference_count: number
  payment_captured: boolean
  /** Cart'taki DİĞER satırlar — içerik değişirse fingerprint değişir. */
  other_line_item_ids: string[]
  total_line_items: number
}

function sha16(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16)
}

export function computeCartCleanupFingerprint(
  payload: CartCleanupFingerprintPayload
): string {
  const canonical = JSON.stringify({
    policy_version: payload.policy_version,
    cart_id: payload.cart_id,
    line_item_id: payload.line_item_id,
    product_id: payload.product_id,
    variant_id: payload.variant_id,
    quantity: payload.quantity,
    unit_price: payload.unit_price,
    cart_completed: payload.cart_completed,
    order_reference_count: payload.order_reference_count,
    payment_captured: payload.payment_captured,
    other_line_item_ids: [...payload.other_line_item_ids].sort(),
    total_line_items: payload.total_line_items,
  })
  return sha16(canonical)
}

export function isCartConfirmationValid(
  confirmToken: string | null | undefined,
  planFingerprint: string
): boolean {
  if (!confirmToken) return false
  return confirmToken.trim() === planFingerprint
}
