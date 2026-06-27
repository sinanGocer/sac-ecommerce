/**
 * Partial Cart Cleanup — SAF orkestrasyon (IO yok).
 */

import {
  computePartialCartFingerprint,
  PartialCartFingerprintPayload,
} from "./partial-cart-fingerprint"
import {
  AllowlistResult,
  buildActions,
  evaluateAllowlist,
  evaluateIdentity,
  evaluateSafety,
  IdentityResult,
  SafetyResult,
} from "./partial-cart-plan"
import {
  ALLOWLISTED_CART_ID,
  EXPECTED_CART,
  PARTIAL_CART_CLEANUP_POLICY_VERSION,
  PartialCartAction,
  PartialCartDecision,
  PartialCartSnapshot,
} from "./partial-cart-policy"

export interface PartialCartPlan {
  allowlist: AllowlistResult
  identity: IdentityResult | null
  safety: SafetyResult | null
  actions: PartialCartAction[]
  fingerprint_payload: PartialCartFingerprintPayload | null
  plan_fingerprint: string | null
  decision: PartialCartDecision
  errors: string[]
}

export function planPartialCartCleanup(
  requestedCartId: string,
  snapshot: PartialCartSnapshot | null
): PartialCartPlan {
  const errors: string[] = []
  const allowlist = evaluateAllowlist(
    requestedCartId,
    ALLOWLISTED_CART_ID,
    !!snapshot?.found
  )

  if (!allowlist.ok || !snapshot) {
    if (allowlist.reason) errors.push(`allowlist:${allowlist.reason}`)
    if (!snapshot) errors.push("snapshot_missing")
    return {
      allowlist,
      identity: null,
      safety: null,
      actions: [],
      fingerprint_payload: null,
      plan_fingerprint: null,
      decision: "PARTIAL_CART_CLEANUP_PLAN_BLOCKED",
      errors,
    }
  }

  // Zaten soft-deleted → idempotent no-op.
  if (snapshot.deleted_at !== null) {
    return {
      allowlist,
      identity: null,
      safety: null,
      actions: buildActions(snapshot),
      fingerprint_payload: null,
      plan_fingerprint: null,
      decision: "PARTIAL_CART_CLEANUP_IDEMPOTENT_NOOP",
      errors,
    }
  }

  const identity = evaluateIdentity(snapshot, EXPECTED_CART)
  const safety = evaluateSafety(snapshot)

  if (!identity.ok) {
    for (const f of identity.mismatches) errors.push(`identity:${f}`)
    return {
      allowlist,
      identity,
      safety,
      actions: [],
      fingerprint_payload: null,
      plan_fingerprint: null,
      decision: "PARTIAL_CART_CLEANUP_STALE_PLAN",
      errors,
    }
  }
  if (!safety.ok) {
    for (const b of safety.blockers) errors.push(`safety:${b}`)
    return {
      allowlist,
      identity,
      safety,
      actions: [],
      fingerprint_payload: null,
      plan_fingerprint: null,
      decision: "PARTIAL_CART_CLEANUP_PLAN_BLOCKED",
      errors,
    }
  }

  const actions = buildActions(snapshot)
  const fingerprintPayload: PartialCartFingerprintPayload = {
    policy_version: PARTIAL_CART_CLEANUP_POLICY_VERSION,
    cart_id: snapshot.cart_id,
    email: snapshot.email,
    variant_id: snapshot.line?.variant_id ?? null,
    quantity: snapshot.line?.quantity ?? null,
    unit_price: snapshot.line?.unit_price ?? null,
    shipping_option_id: snapshot.shipping_option_id,
    shipping_total: snapshot.shipping_total,
    total: snapshot.total,
    payment_provider_id: snapshot.payment_provider_id,
    payment_session_id: snapshot.payment_session_id,
    deleted_at: snapshot.deleted_at,
    order_reference_count: snapshot.order_reference_count,
    inventory_reservation_count: snapshot.inventory_reservation_count,
    planned_actions: actions.map((a) => ({ action: a.action, status: a.status })),
  }

  return {
    allowlist,
    identity,
    safety,
    actions,
    fingerprint_payload: fingerprintPayload,
    plan_fingerprint: computePartialCartFingerprint(fingerprintPayload),
    decision: "PARTIAL_CART_CLEANUP_DRY_RUN_READY",
    errors,
  }
}
