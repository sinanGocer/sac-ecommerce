/**
 * Partial Cart Cleanup — rapor + commit komutu (SAF).
 */

import { PartialCartPlan } from "./partial-cart-service"
import {
  ALLOWLISTED_CART_ID,
  PARTIAL_CART_CLEANUP_POLICY_VERSION,
  PartialCartAction,
  PartialCartDecision,
  PartialCartSnapshot,
} from "./partial-cart-policy"

export interface PartialCartReport {
  run_id: string
  started_at: string
  finished_at: string
  mode: "dry-run" | "commit"
  policy_version: number
  cart_id: string
  allowlist_result: PartialCartPlan["allowlist"]
  gate_results: {
    allowlist_ok: boolean
    identity_ok: boolean | null
    identity_mismatches: string[]
    safety_ok: boolean | null
    safety_blockers: string[]
  }
  cart_state: PartialCartSnapshot | null
  planned_actions: PartialCartAction[]
  base_fingerprint: string | null
  plan_fingerprint: string | null
  commit_enabled: boolean
  db_writes: number
  final_decision: PartialCartDecision
  cleanup_strategy: string
  errors: string[]
  commit_command: string | null
}

export function buildPartialCartCommitCommand(planFingerprint: string): string {
  return (
    `cd ~/sac-ecommerce/apps/backend && env ` +
    `PARTIAL_CART_CLEANUP_CART_ID=${ALLOWLISTED_CART_ID} ` +
    `PARTIAL_CART_CLEANUP_COMMIT=true ` +
    `PARTIAL_CART_CLEANUP_CONFIRM=${planFingerprint} ` +
    `npm run partial-cart:cleanup`
  )
}

export function buildPartialCartReport(params: {
  runId: string
  startedAt: string
  finishedAt: string
  mode: "dry-run" | "commit"
  snapshot: PartialCartSnapshot | null
  plan: PartialCartPlan
  commitEnabled: boolean
  dbWrites: number
  finalDecision: PartialCartDecision
  actions: PartialCartAction[]
}): PartialCartReport {
  const { plan, snapshot } = params
  return {
    run_id: params.runId,
    started_at: params.startedAt,
    finished_at: params.finishedAt,
    mode: params.mode,
    policy_version: PARTIAL_CART_CLEANUP_POLICY_VERSION,
    cart_id: plan.allowlist.requested_cart_id,
    allowlist_result: plan.allowlist,
    gate_results: {
      allowlist_ok: plan.allowlist.ok,
      identity_ok: plan.identity ? plan.identity.ok : null,
      identity_mismatches: plan.identity ? plan.identity.mismatches : [],
      safety_ok: plan.safety ? plan.safety.ok : null,
      safety_blockers: plan.safety ? plan.safety.blockers : [],
    },
    cart_state: snapshot,
    planned_actions: params.actions,
    base_fingerprint: plan.plan_fingerprint,
    plan_fingerprint: plan.plan_fingerprint,
    commit_enabled: params.commitEnabled,
    db_writes: params.dbWrites,
    final_decision: params.finalDecision,
    cleanup_strategy:
      "soft_delete (deleted_at set; audit korunur; hard delete YOK; order/inventory/payment-capture'a dokunulmaz)",
    errors: plan.errors,
    commit_command:
      params.mode === "dry-run" && plan.plan_fingerprint
        ? buildPartialCartCommitCommand(plan.plan_fingerprint)
        : null,
  }
}
