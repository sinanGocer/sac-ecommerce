/**
 * Checkout Test Order — rapor yapısı + commit komutu (SAF).
 */

import { ExecutionResult } from "./checkout-test-executor"
import { CheckoutTestPlan } from "./checkout-test-service"
import {
  CHECKOUT_TEST_ORDER_POLICY_VERSION,
  CheckoutTestDecision,
  CheckoutTestSnapshot,
  TEST_ADDRESS,
  TEST_EMAIL,
} from "./checkout-test-policy"

export interface CheckoutTestReport {
  run_id: string
  started_at: string
  finished_at: string
  mode: "dry-run" | "commit"
  policy_version: number
  selected_product: Record<string, unknown> | null
  selected_variant: { id: string | null; sku: string | null; unit_price: number | null } | null
  shipping_option: Record<string, unknown> | null
  payment_provider: Record<string, unknown> | null
  duplicate_gate: CheckoutTestSnapshot["duplicate_gate"] | null
  inventory_location_candidates: CheckoutTestSnapshot["inventory_location_candidates"]
  test_identity: { email: string; country_code: string; city: string }
  expected_totals: CheckoutTestPlan["totals"]
  execution_started: boolean
  execution: ExecutionResult | null
  gates: { blockers: Array<{ gate: string; stage: string }>; blocked_count: number }
  planned_actions: CheckoutTestPlan["stages"]
  commit_enabled: boolean
  estimated_mutations: number
  actual_mutations: number
  plan_fingerprint: string | null
  generated_commit_command: string | null
  cancellation_plan: CheckoutTestPlan["cancellation_plan"]
  errors: string[]
  final_decision: CheckoutTestDecision
}

export function buildCheckoutTestCommitCommand(planFingerprint: string): string {
  return (
    `cd ~/sac-ecommerce/apps/backend && env ` +
    `CHECKOUT_TEST_COMMIT=true ` +
    `CHECKOUT_TEST_CONFIRM=${planFingerprint} ` +
    `npm run checkout:test-order`
  )
}

export function buildCheckoutTestReport(params: {
  runId: string
  startedAt: string
  finishedAt: string
  mode: "dry-run" | "commit"
  snapshot: CheckoutTestSnapshot | null
  plan: CheckoutTestPlan
  commitEnabled: boolean
  actualMutations: number
  finalDecision: CheckoutTestDecision
  execution?: ExecutionResult | null
}): CheckoutTestReport {
  const { plan, snapshot } = params
  const p = snapshot?.product ?? null

  return {
    run_id: params.runId,
    started_at: params.startedAt,
    finished_at: params.finishedAt,
    mode: params.mode,
    policy_version: CHECKOUT_TEST_ORDER_POLICY_VERSION,
    selected_product: p
      ? {
          id: p.id,
          status: p.status,
          in_sales_channel: p.in_sales_channel,
          manage_inventory: p.manage_inventory,
          reservable_quantity: p.reservable_quantity,
          variant_count: p.variant_count,
          shipping_profile_id: p.shipping_profile_id,
        }
      : null,
    selected_variant: p ? { id: p.variant_id, sku: p.sku, unit_price: p.unit_price } : null,
    shipping_option: snapshot?.shipping_option
      ? { ...snapshot.shipping_option }
      : null,
    payment_provider: snapshot?.payment_provider ? { ...snapshot.payment_provider } : null,
    duplicate_gate: snapshot?.duplicate_gate ?? null,
    inventory_location_candidates: snapshot?.inventory_location_candidates ?? [],
    test_identity: { email: TEST_EMAIL, country_code: TEST_ADDRESS.country_code, city: TEST_ADDRESS.city },
    expected_totals: plan.totals,
    execution_started: params.execution?.execution_started ?? false,
    execution: params.execution ?? null,
    gates: { blockers: plan.blockers, blocked_count: plan.blockers.length },
    planned_actions: plan.stages,
    commit_enabled: params.commitEnabled,
    estimated_mutations: plan.estimated_mutations,
    actual_mutations: params.actualMutations,
    plan_fingerprint: plan.plan_fingerprint,
    generated_commit_command:
      params.mode === "dry-run" && plan.plan_fingerprint
        ? buildCheckoutTestCommitCommand(plan.plan_fingerprint)
        : null,
    cancellation_plan: plan.cancellation_plan,
    errors: plan.errors,
    final_decision: params.finalDecision,
  }
}
