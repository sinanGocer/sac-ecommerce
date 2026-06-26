/**
 * Cart Line Cleanup — SAF plan mantığı (IO yok, deterministik).
 *
 * - Allowlist gate (tek cart + tek line item)
 * - Hedef kimlik gate (product/variant/quantity/unit_price)
 * - Güvenlik gate (cart completed_at null, order ref 0, payment captured değil)
 * - Planlı aksiyon (planned | no_op); cart'taki DİĞER satırlar korunur
 */

import {
  CartCleanupAction,
  CartReferenceCounts,
  CartSnapshot,
  ExpectedTarget,
} from "./cart-line-cleanup-policy"

// ── Allowlist ────────────────────────────────────────────────────────────────

export interface CartAllowlistResult {
  requested_cart_id: string
  requested_line_item_id: string
  allowlisted_cart_id: string
  allowlisted_line_item_id: string
  requested_count: number
  matched_count: number
  ok: boolean
  reason: string | null
}

export function evaluateCartAllowlist(
  requestedCartId: string,
  requestedLineItemId: string,
  allowlistedCartId: string,
  allowlistedLineItemId: string,
  cartFound: boolean
): CartAllowlistResult {
  const cartOk = requestedCartId === allowlistedCartId
  const lineOk = requestedLineItemId === allowlistedLineItemId
  const requestedCount = cartOk && lineOk ? 1 : 0
  const matchedCount = cartFound ? 1 : 0
  let reason: string | null = null
  if (!cartOk) reason = "requested_cart_not_allowlisted"
  else if (!lineOk) reason = "requested_line_not_allowlisted"
  else if (!cartFound) reason = "cart_not_found"
  return {
    requested_cart_id: requestedCartId,
    requested_line_item_id: requestedLineItemId,
    allowlisted_cart_id: allowlistedCartId,
    allowlisted_line_item_id: allowlistedLineItemId,
    requested_count: requestedCount,
    matched_count: matchedCount,
    ok: cartOk && lineOk && cartFound,
    reason,
  }
}

// ── Hedef kimlik ─────────────────────────────────────────────────────────────

export interface TargetIdentityResult {
  ok: boolean
  /** Hedef satır cart'ta var mı (yoksa idempotent no-op). */
  target_present: boolean
  mismatches: Array<{ field: string; expected: unknown; actual: unknown }>
  target_snapshot: Record<string, unknown> | null
}

export function evaluateTargetIdentity(
  snapshot: CartSnapshot,
  expected: ExpectedTarget
): TargetIdentityResult {
  const target = snapshot.items.find((i) => i.id === expected.line_item_id)
  if (!target) {
    return { ok: false, target_present: false, mismatches: [], target_snapshot: null }
  }
  const mismatches: TargetIdentityResult["mismatches"] = []
  const push = (f: string, e: unknown, a: unknown): void => {
    mismatches.push({ field: f, expected: e, actual: a })
  }
  if (snapshot.cart_id !== expected.cart_id) push("cart_id", expected.cart_id, snapshot.cart_id)
  if (target.product_id !== expected.product_id) push("product_id", expected.product_id, target.product_id)
  if (target.variant_id !== expected.variant_id) push("variant_id", expected.variant_id, target.variant_id)
  if (target.quantity !== expected.quantity) push("quantity", expected.quantity, target.quantity)
  if (target.unit_price !== expected.unit_price) push("unit_price", expected.unit_price, target.unit_price)
  return {
    ok: mismatches.length === 0,
    target_present: true,
    mismatches,
    target_snapshot: {
      line_item_id: target.id,
      product_id: target.product_id,
      variant_id: target.variant_id,
      quantity: target.quantity,
      unit_price: target.unit_price,
      title: target.title,
    },
  }
}

// ── Güvenlik gate (cart durumu) ──────────────────────────────────────────────

export interface CartSafetyResult {
  ok: boolean
  blockers: string[]
  cart_completed: boolean
  payment_captured: boolean
  order_reference_count: number
}

export function evaluateCartSafety(
  snapshot: CartSnapshot,
  counts: CartReferenceCounts
): CartSafetyResult {
  const blockers: string[] = []
  const cartCompleted = snapshot.completed_at !== null
  const paymentCaptured = snapshot.payment_captured_amount > 0
  if (cartCompleted) blockers.push("cart_completed")
  if (counts.order_reference_count > 0) blockers.push("order_reference")
  if (paymentCaptured) blockers.push("payment_captured")
  return {
    ok: blockers.length === 0,
    blockers,
    cart_completed: cartCompleted,
    payment_captured: paymentCaptured,
    order_reference_count: counts.order_reference_count,
  }
}

// ── Planlı aksiyon ───────────────────────────────────────────────────────────

export function buildCartCleanupAction(
  snapshot: CartSnapshot,
  expected: ExpectedTarget
): CartCleanupAction {
  const target = snapshot.items.find((i) => i.id === expected.line_item_id)
  const otherIds = snapshot.items
    .filter((i) => i.id !== expected.line_item_id)
    .map((i) => i.id)
    .sort()
  return {
    action: "CART_LINE_REMOVE",
    status: target ? "planned" : "no_op",
    executed: false,
    db_writes: 0,
    detail: {
      cart_id: snapshot.cart_id,
      target_line_item_id: expected.line_item_id,
      target_present: !!target,
      preserved_line_item_ids: otherIds,
      preserved_line_item_count: otherIds.length,
      expected_remaining_line_items: target ? otherIds.length : snapshot.items.length,
    },
  }
}
