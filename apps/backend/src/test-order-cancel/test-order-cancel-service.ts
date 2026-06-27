/**
 * Test Order Cancel — SAF orkestrasyon (IO yok).
 */

import {
  computeTestOrderCancelFingerprint,
  TestOrderCancelFingerprintPayload,
} from "./test-order-cancel-fingerprint"
import {
  AllowlistResult,
  buildActions,
  evaluateAllowlist,
  evaluateIdentity,
  evaluateSafety,
  IdentityResult,
  SafetyResult,
} from "./test-order-cancel-plan"
import {
  ALLOWLISTED_ORDER_ID,
  CancelAction,
  EXPECTED_ORDER,
  TEST_ORDER_CANCEL_POLICY_VERSION,
  TestOrderCancelDecision,
  TestOrderSnapshot,
} from "./test-order-cancel-policy"

export interface TestOrderCancelPlan {
  allowlist: AllowlistResult
  identity: IdentityResult | null
  safety: SafetyResult | null
  actions: CancelAction[]
  fingerprint_payload: TestOrderCancelFingerprintPayload | null
  plan_fingerprint: string | null
  decision: TestOrderCancelDecision
  errors: string[]
}

export function planTestOrderCancel(
  requestedOrderId: string,
  snapshot: TestOrderSnapshot | null
): TestOrderCancelPlan {
  const errors: string[] = []
  const allowlist = evaluateAllowlist(
    requestedOrderId,
    ALLOWLISTED_ORDER_ID,
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
      decision: "TEST_ORDER_CANCEL_PLAN_BLOCKED",
      errors,
    }
  }

  // Zaten iptal → idempotent no-op.
  if (snapshot.canceled_at !== null || snapshot.status === "canceled") {
    return {
      allowlist,
      identity: null,
      safety: null,
      actions: [],
      fingerprint_payload: null,
      plan_fingerprint: null,
      decision: "TEST_ORDER_CANCEL_IDEMPOTENT_NOOP",
      errors,
    }
  }

  const identity = evaluateIdentity(snapshot, EXPECTED_ORDER)
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
      decision: "TEST_ORDER_CANCEL_STALE_PLAN",
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
      decision: "TEST_ORDER_CANCEL_PLAN_BLOCKED",
      errors,
    }
  }

  const actions = buildActions(snapshot)
  const fingerprintPayload: TestOrderCancelFingerprintPayload = {
    policy_version: TEST_ORDER_CANCEL_POLICY_VERSION,
    order_id: snapshot.order_id,
    display_id: snapshot.display_id,
    email: snapshot.email,
    has_test_marker: snapshot.has_test_marker,
    order_status: snapshot.status,
    payment_status: snapshot.payment_status,
    authorized_amount: snapshot.authorized_amount,
    captured_amount: snapshot.captured_amount,
    refund_amount: snapshot.refund_amount,
    order_total: snapshot.authoritative_total,
    variant_id: snapshot.line?.variant_id ?? null,
    sku: snapshot.line?.sku ?? null,
    quantity: snapshot.line?.quantity ?? null,
    unit_price: snapshot.line?.unit_price ?? null,
    shipping_method_name: snapshot.shipping_method_name,
    shipping_amount: snapshot.shipping_amount,
    reservation_ids: snapshot.reservation_ids,
    reservation_quantity: snapshot.reservation_quantity,
    inventory_stocked: snapshot.inventory_stocked,
    inventory_reserved: snapshot.inventory_reserved,
    fulfillment_count: snapshot.fulfillment_count,
    return_count: snapshot.return_count,
    claim_count: snapshot.claim_count,
    exchange_count: snapshot.exchange_count,
    planned_actions: actions.map((a) => ({ action: a.action, status: a.status })),
  }

  return {
    allowlist,
    identity,
    safety,
    actions,
    fingerprint_payload: fingerprintPayload,
    plan_fingerprint: computeTestOrderCancelFingerprint(fingerprintPayload),
    decision: "TEST_ORDER_CANCEL_DRY_RUN_READY",
    errors,
  }
}
