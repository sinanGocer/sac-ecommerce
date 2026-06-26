/**
 * Cart Line Cleanup — rapor yapısı + commit komutu (SAF).
 */

import { CartCleanupPlan } from "./cart-line-cleanup-service"
import {
  ALLOWLISTED_CART_ID,
  ALLOWLISTED_LINE_ITEM_ID,
  CART_CLEANUP_POLICY_VERSION,
  CartCleanupAction,
  CartReferenceCounts,
  CartSnapshot,
  CartCleanupDecision,
} from "./cart-line-cleanup-policy"

export interface CartCleanupReport {
  run_id: string
  started_at: string
  finished_at: string
  mode: "dry-run" | "commit"
  policy_version: number
  cart_id: string
  line_item_id: string
  allowlist_result: CartCleanupPlan["allowlist"]
  gate_results: {
    allowlist_ok: boolean
    target_present: boolean | null
    identity_ok: boolean | null
    identity_mismatches: string[]
    safety_ok: boolean | null
    safety_blockers: string[]
    cart_completed: boolean | null
    payment_captured: boolean | null
    order_reference_count: number | null
  }
  cart_state: {
    completed_at: string | null
    payment_collection_exists: boolean
    payment_sessions: number
    total_line_items: number
    other_line_items: number
  } | null
  target_snapshot: Record<string, unknown> | null
  preserved_line_item_ids: string[]
  planned_action: CartCleanupAction | null
  base_fingerprint: string | null
  plan_fingerprint: string | null
  commit_enabled: boolean
  db_writes: number
  final_decision: CartCleanupDecision
  commit_command: string | null
  errors: string[]
}

export function buildCartCommitCommand(planFingerprint: string): string {
  return (
    `cd ~/sac-ecommerce/apps/backend && env ` +
    `CART_CLEANUP_CART_ID=${ALLOWLISTED_CART_ID} ` +
    `CART_CLEANUP_LINE_ITEM_ID=${ALLOWLISTED_LINE_ITEM_ID} ` +
    `CART_CLEANUP_COMMIT=true ` +
    `CART_CLEANUP_CONFIRM=${planFingerprint} ` +
    `npm run cart:cleanup`
  )
}

export function buildCartCleanupReport(params: {
  runId: string
  startedAt: string
  finishedAt: string
  mode: "dry-run" | "commit"
  snapshot: CartSnapshot | null
  counts: CartReferenceCounts | null
  plan: CartCleanupPlan
  commitEnabled: boolean
  dbWrites: number
  finalDecision: CartCleanupDecision
  action: CartCleanupAction | null
}): CartCleanupReport {
  const { plan, snapshot, counts } = params
  const preserved =
    (plan.action?.detail.preserved_line_item_ids as string[] | undefined) ?? []

  return {
    run_id: params.runId,
    started_at: params.startedAt,
    finished_at: params.finishedAt,
    mode: params.mode,
    policy_version: CART_CLEANUP_POLICY_VERSION,
    cart_id: plan.allowlist.requested_cart_id,
    line_item_id: plan.allowlist.requested_line_item_id,
    allowlist_result: plan.allowlist,
    gate_results: {
      allowlist_ok: plan.allowlist.ok,
      target_present: plan.identity ? plan.identity.target_present : null,
      identity_ok: plan.identity ? plan.identity.ok : null,
      identity_mismatches: plan.identity
        ? plan.identity.mismatches.map((m) => m.field)
        : [],
      safety_ok: plan.safety ? plan.safety.ok : null,
      safety_blockers: plan.safety ? plan.safety.blockers : [],
      cart_completed: plan.safety ? plan.safety.cart_completed : null,
      payment_captured: plan.safety ? plan.safety.payment_captured : null,
      order_reference_count: plan.safety ? plan.safety.order_reference_count : null,
    },
    cart_state: snapshot
      ? {
          completed_at: snapshot.completed_at,
          payment_collection_exists: snapshot.payment_collection_exists,
          payment_sessions: snapshot.payment_sessions,
          total_line_items: snapshot.items.length,
          other_line_items: counts?.other_line_items ?? snapshot.items.length - 1,
        }
      : null,
    target_snapshot: plan.identity?.target_snapshot ?? null,
    preserved_line_item_ids: preserved,
    planned_action: params.action,
    base_fingerprint: plan.plan_fingerprint,
    plan_fingerprint: plan.plan_fingerprint,
    commit_enabled: params.commitEnabled,
    db_writes: params.dbWrites,
    final_decision: params.finalDecision,
    commit_command:
      params.mode === "dry-run" && plan.plan_fingerprint
        ? buildCartCommitCommand(plan.plan_fingerprint)
        : null,
    errors: plan.errors,
  }
}
