/**
 * Cart Line Cleanup — SAF orkestrasyon (IO yok).
 *
 * Snapshot + referans sayaçlarını alır; allowlist → hedef kimlik → güvenlik →
 * plan → fingerprint sırasıyla fail-closed bir plan üretir. DB/workflow ÇAĞIRMAZ.
 */

import {
  computeCartCleanupFingerprint,
  CartCleanupFingerprintPayload,
} from "./cart-line-cleanup-fingerprint"
import {
  buildCartCleanupAction,
  CartAllowlistResult,
  CartSafetyResult,
  evaluateCartAllowlist,
  evaluateCartSafety,
  evaluateTargetIdentity,
  TargetIdentityResult,
} from "./cart-line-cleanup-plan"
import {
  ALLOWLISTED_CART_ID,
  ALLOWLISTED_LINE_ITEM_ID,
  CART_CLEANUP_POLICY_VERSION,
  CartCleanupAction,
  CartCleanupDecision,
  CartReferenceCounts,
  CartSnapshot,
  EXPECTED_TARGET,
} from "./cart-line-cleanup-policy"

export interface CartCleanupInput {
  requestedCartId: string
  requestedLineItemId: string
  snapshot: CartSnapshot | null
  counts: CartReferenceCounts | null
}

export interface CartCleanupPlan {
  allowlist: CartAllowlistResult
  identity: TargetIdentityResult | null
  safety: CartSafetyResult | null
  action: CartCleanupAction | null
  fingerprint_payload: CartCleanupFingerprintPayload | null
  plan_fingerprint: string | null
  decision: CartCleanupDecision
  errors: string[]
}

export function planCartCleanup(input: CartCleanupInput): CartCleanupPlan {
  const errors: string[] = []
  const allowlist = evaluateCartAllowlist(
    input.requestedCartId,
    input.requestedLineItemId,
    ALLOWLISTED_CART_ID,
    ALLOWLISTED_LINE_ITEM_ID,
    !!input.snapshot
  )

  // 1) Allowlist fail-closed.
  if (!allowlist.ok || !input.snapshot || !input.counts) {
    if (!allowlist.ok && allowlist.reason) errors.push(`allowlist:${allowlist.reason}`)
    if (!input.snapshot) errors.push("snapshot_missing")
    if (!input.counts) errors.push("reference_counts_missing")
    return {
      allowlist,
      identity: null,
      safety: null,
      action: null,
      fingerprint_payload: null,
      plan_fingerprint: null,
      decision: "CART_CLEANUP_PLAN_BLOCKED",
      errors,
    }
  }

  const identity = evaluateTargetIdentity(input.snapshot, EXPECTED_TARGET)
  const safety = evaluateCartSafety(input.snapshot, input.counts)

  // 2) Hedef satır yoksa → idempotent no-op (zaten kaldırılmış).
  if (!identity.target_present) {
    const action = buildCartCleanupAction(input.snapshot, EXPECTED_TARGET)
    return {
      allowlist,
      identity,
      safety,
      action,
      fingerprint_payload: null,
      plan_fingerprint: null,
      decision: "CART_CLEANUP_IDEMPOTENT_NOOP",
      errors,
    }
  }

  // 3) Hedef kimlik uyuşmuyorsa → stale plan.
  if (!identity.ok) {
    for (const m of identity.mismatches) errors.push(`identity:${m.field}`)
    return {
      allowlist,
      identity,
      safety,
      action: null,
      fingerprint_payload: null,
      plan_fingerprint: null,
      decision: "CART_CLEANUP_STALE_PLAN",
      errors,
    }
  }

  // 4) Güvenlik gate (completed/order/payment) → blocked.
  if (!safety.ok) {
    for (const b of safety.blockers) errors.push(`safety:${b}`)
    return {
      allowlist,
      identity,
      safety,
      action: null,
      fingerprint_payload: null,
      plan_fingerprint: null,
      decision: "CART_CLEANUP_PLAN_BLOCKED",
      errors,
    }
  }

  // 5) Plan + fingerprint.
  const action = buildCartCleanupAction(input.snapshot, EXPECTED_TARGET)
  const target = input.snapshot.items.find((i) => i.id === EXPECTED_TARGET.line_item_id)!
  const otherIds = input.snapshot.items
    .filter((i) => i.id !== EXPECTED_TARGET.line_item_id)
    .map((i) => i.id)
    .sort()
  const fingerprintPayload: CartCleanupFingerprintPayload = {
    policy_version: CART_CLEANUP_POLICY_VERSION,
    cart_id: input.snapshot.cart_id,
    line_item_id: EXPECTED_TARGET.line_item_id,
    product_id: target.product_id,
    variant_id: target.variant_id,
    quantity: target.quantity,
    unit_price: target.unit_price,
    cart_completed: safety.cart_completed,
    order_reference_count: safety.order_reference_count,
    payment_captured: safety.payment_captured,
    other_line_item_ids: otherIds,
    total_line_items: input.snapshot.items.length,
  }
  const planFingerprint = computeCartCleanupFingerprint(fingerprintPayload)

  return {
    allowlist,
    identity,
    safety,
    action,
    fingerprint_payload: fingerprintPayload,
    plan_fingerprint: planFingerprint,
    decision: "CART_CLEANUP_DRY_RUN_READY",
    errors,
  }
}
