/**
 * Partial Cart Cleanup — SAF plan mantığı (IO yok, deterministik).
 *
 * Allowlist → kimlik gate → güvenlik gate → soft-delete aksiyonları.
 * Order/inventory/payment-capture varsa fail-closed durur. Hard delete YOK.
 */

import {
  ExpectedCart,
  PartialCartAction,
  PartialCartSnapshot,
} from "./partial-cart-policy"

export interface AllowlistResult {
  requested_cart_id: string
  allowlisted_cart_id: string
  requested_count: number
  matched_count: number
  ok: boolean
  reason: string | null
}

export function evaluateAllowlist(
  requestedCartId: string,
  allowlistedCartId: string,
  found: boolean
): AllowlistResult {
  const idOk = requestedCartId === allowlistedCartId
  let reason: string | null = null
  if (!idOk) reason = "requested_cart_not_allowlisted"
  else if (!found) reason = "cart_not_found"
  return {
    requested_cart_id: requestedCartId,
    allowlisted_cart_id: allowlistedCartId,
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
  snap: PartialCartSnapshot,
  expected: ExpectedCart
): IdentityResult {
  const m: string[] = []
  if (snap.cart_id !== expected.cart_id) m.push("cart_id")
  if (snap.email !== expected.email) m.push("email")
  if (snap.item_count !== expected.item_count) m.push("item_count")
  if (!snap.line) m.push("line_missing")
  else {
    if (snap.line.variant_id !== expected.variant_id) m.push("variant_id")
    if (snap.line.quantity !== expected.quantity) m.push("quantity")
    if (snap.line.unit_price !== expected.unit_price) m.push("unit_price")
  }
  if (snap.shipping_option_id !== expected.shipping_option_id) m.push("shipping_option_id")
  if (snap.shipping_total !== expected.shipping_total) m.push("shipping_total")
  if (snap.total !== expected.total) m.push("total")
  if (snap.payment_provider_id !== expected.payment_provider_id) m.push("payment_provider_id")
  return { ok: m.length === 0, mismatches: m }
}

export interface SafetyResult {
  ok: boolean
  blockers: string[]
}

/**
 * Güvenlik gate: cart tamamlanmamış, order'a dönmemiş, ödeme capture edilmemiş,
 * inventory reservation oluşmamış olmalı. Aksi halde cleanup bloklanır.
 */
export function evaluateSafety(snap: PartialCartSnapshot): SafetyResult {
  const b: string[] = []
  if (snap.completed_at !== null) b.push("cart_completed")
  if (snap.order_reference_count > 0) b.push("order_reference")
  if (snap.payment_captured_amount > 0) b.push("payment_captured")
  if (snap.inventory_reservation_count > 0) b.push("inventory_reserved")
  return { ok: b.length === 0, blockers: b }
}

/**
 * Aksiyonlar: pending payment session varsa sil; ardından cart'ı SOFT-DELETE et.
 * Cart zaten soft-deleted ise CART_SOFT_DELETE no_op; session yoksa session
 * aksiyonu no_op (idempotent).
 */
export function buildActions(snap: PartialCartSnapshot): PartialCartAction[] {
  const sessionPresent = snap.payment_session_id !== null
  const cartActive = snap.deleted_at === null
  return [
    {
      action: "PAYMENT_SESSION_DELETE",
      status: sessionPresent ? "planned" : "no_op",
      executed: false,
      db_writes: 0,
      detail: {
        payment_session_id: snap.payment_session_id,
        payment_session_status: snap.payment_session_status,
        note: "pending system-provider session; gerçek para yok, capture/refund tetiklenmez.",
      },
    },
    {
      action: "CART_SOFT_DELETE",
      status: cartActive ? "planned" : "no_op",
      executed: false,
      db_writes: 0,
      detail: {
        cart_id: snap.cart_id,
        strategy: "soft_delete",
        note: "deleted_at set edilir; kayıt korunur (audit). HARD DELETE değil. Diğer cart'lara dokunulmaz.",
      },
    },
  ]
}
