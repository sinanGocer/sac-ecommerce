/**
 * Test Order Cancel — rapor + commit komutu (SAF).
 */

import { TestOrderCancelPlan } from "./test-order-cancel-service"
import {
  ALLOWLISTED_ORDER_ID,
  CancelAction,
  TEST_ORDER_CANCEL_POLICY_VERSION,
  TestOrderCancelDecision,
  TestOrderSnapshot,
} from "./test-order-cancel-policy"

export interface TestOrderCancelReport {
  run_id: string
  started_at: string
  finished_at: string
  mode: "dry-run" | "commit"
  policy_version: number
  order_id: string
  allowlist_result: TestOrderCancelPlan["allowlist"]
  order_identity: Record<string, unknown> | null
  safety_checks: { ok: boolean | null; blockers: string[] }
  before_snapshot: TestOrderSnapshot | null
  expected_after_snapshot: Record<string, unknown> | null
  planned_actions: CancelAction[]
  estimated_mutations: number
  actual_mutations: number
  db_writes: number
  base_fingerprint: string | null
  plan_fingerprint: string | null
  commit_enabled: boolean
  cancellation_strategy: string
  errors: string[]
  final_decision: TestOrderCancelDecision
  execution_command: string | null
}

export function buildTestOrderCancelCommand(planFingerprint: string): string {
  return (
    `cd ~/sac-ecommerce/apps/backend && env ` +
    `TEST_ORDER_CANCEL_ORDER_ID=${ALLOWLISTED_ORDER_ID} ` +
    `TEST_ORDER_CANCEL_COMMIT=true ` +
    `TEST_ORDER_CANCEL_CONFIRM=${planFingerprint} ` +
    `npm run test-order:cancel`
  )
}

export function buildTestOrderCancelReport(params: {
  runId: string
  startedAt: string
  finishedAt: string
  mode: "dry-run" | "commit"
  snapshot: TestOrderSnapshot | null
  plan: TestOrderCancelPlan
  commitEnabled: boolean
  actualMutations: number
  dbWrites: number
  finalDecision: TestOrderCancelDecision
  actions: CancelAction[]
}): TestOrderCancelReport {
  const { plan, snapshot } = params
  const estimated = params.actions.filter((a) => !a.workflow_internal && a.status === "planned").length

  return {
    run_id: params.runId,
    started_at: params.startedAt,
    finished_at: params.finishedAt,
    mode: params.mode,
    policy_version: TEST_ORDER_CANCEL_POLICY_VERSION,
    order_id: plan.allowlist.requested_order_id,
    allowlist_result: plan.allowlist,
    order_identity: snapshot
      ? {
          order_id: snapshot.order_id,
          display_id: snapshot.display_id,
          status: snapshot.status,
          email: snapshot.email,
          authoritative_total: snapshot.authoritative_total,
          payment_status: snapshot.payment_status,
          authorized_amount: snapshot.authorized_amount,
          captured_amount: snapshot.captured_amount,
          has_test_marker: snapshot.has_test_marker,
        }
      : null,
    safety_checks: { ok: plan.safety ? plan.safety.ok : null, blockers: plan.safety ? plan.safety.blockers : [] },
    before_snapshot: snapshot,
    expected_after_snapshot: snapshot
      ? {
          order_status: "canceled",
          order_deleted: false,
          inventory_reserved: 0,
          inventory_stocked: snapshot.inventory_stocked,
          captured_amount: 0,
          refund_amount: 0,
          reservation_ids_after: [],
        }
      : null,
    planned_actions: params.actions,
    estimated_mutations: estimated,
    actual_mutations: params.actualMutations,
    db_writes: params.dbWrites,
    base_fingerprint: plan.plan_fingerprint,
    plan_fingerprint: plan.plan_fingerprint,
    commit_enabled: params.commitEnabled,
    cancellation_strategy:
      "cancelOrderWorkflow (cancel-not-delete; reservation release + uncaptured payment cancel WORKFLOW içinde; captured 0 → refund yok; order/audit korunur)",
    errors: plan.errors,
    final_decision: params.finalDecision,
    execution_command:
      params.mode === "dry-run" && plan.plan_fingerprint
        ? buildTestOrderCancelCommand(plan.plan_fingerprint)
        : null,
  }
}
