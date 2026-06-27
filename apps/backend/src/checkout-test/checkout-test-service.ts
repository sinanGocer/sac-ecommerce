/**
 * Checkout Test Order — SAF orkestrasyon (IO yok).
 *
 * Snapshot → resolve/safety gate'leri → 12 aşama → beklenen totals → fingerprint
 * → karar. Hiçbir cart/order/payment mutation ÇAĞIRMAZ.
 */

import {
  addressSignature,
  CheckoutTestFingerprintPayload,
  computeCheckoutTestFingerprint,
} from "./checkout-test-fingerprint"
import { evaluateCheckoutTestStages } from "./checkout-test-plan"
import {
  CANCELLATION_STRATEGY_VERSION,
  CART_TOTAL_CONSISTENCY_GATE_VERSION,
  CHECKOUT_TEST_ORDER_POLICY_VERSION,
  CheckoutTestDecision,
  DUPLICATE_GATE_VERSION,
  CheckoutTestSnapshot,
  COUNTRY_CODE,
  EXECUTION_STRATEGY_VERSION,
  ExpectedTotals,
  MONEY_NORMALIZATION_VERSION,
  MUTATION_SEQUENCE,
  PRE_COMPLETE_GATE_VERSION,
  QUANTITY,
  RECOVERY_STRATEGY_VERSION,
  SHIPPING_AMOUNT_RESOLUTION_STRATEGY,
  StageResult,
  TEST_ADDRESS,
  TEST_EMAIL,
} from "./checkout-test-policy"

export interface CancellationPlan {
  approach: string
  steps: string[]
  order_delete: false
  notes: string[]
}

export interface CheckoutTestPlan {
  stages: StageResult[]
  totals: ExpectedTotals
  blockers: Array<{ gate: string; stage: string }>
  fingerprint_payload: CheckoutTestFingerprintPayload | null
  plan_fingerprint: string | null
  estimated_mutations: number
  cancellation_plan: CancellationPlan
  decision: CheckoutTestDecision
  errors: string[]
}

const CANCELLATION_PLAN: CancellationPlan = {
  approach:
    "Test siparişi oluşturulduktan SONRA, ayrı/açık onaylı bir adımda iptal edilir. Otomatik iptal bu araca GÖMÜLMEZ.",
  steps: [
    "Order read-only doğrula (status, items, total, payment, fulfillment yok)",
    "cancelOrderWorkflow (Medusa public) ile order iptal — inventory reservation geri yüklenir",
    "Payment: pp_system_default capture gerçek değil; refund/capture manuel tetiklenmez",
    "Fulfillment/shipment oluşturulmadığından iptal güvenli",
    "Order kaydı SİLİNMEZ (audit izi korunur); yalnız cancel",
  ],
  order_delete: false,
  notes: [
    "Inventory: manage_inventory=true ürün için completion'da reservation oluşur; cancel reservation'ı serbest bırakır.",
    "Notification provider local/console → gerçek e-posta gitmez.",
  ],
}

export function planCheckoutTest(
  snapshot: CheckoutTestSnapshot | null
): CheckoutTestPlan {
  if (!snapshot) {
    return {
      stages: [],
      totals: { subtotal: 0, shipping_total: 0, tax_total: 0, grand_total: 0 },
      blockers: [{ gate: "snapshot_missing", stage: "PRODUCT_AND_VARIANT_RESOLVE" }],
      fingerprint_payload: null,
      plan_fingerprint: null,
      estimated_mutations: 0,
      cancellation_plan: CANCELLATION_PLAN,
      decision: "CHECKOUT_TEST_ORDER_BLOCKED",
      errors: ["snapshot_missing"],
    }
  }

  const { stages, totals, blockers } = evaluateCheckoutTestStages(snapshot)
  // Duplicate gate (v2): aktif test ORDER veya aktif PARTIAL test CART varsa block.
  if (snapshot.duplicate_gate.active_test_order_count > 0) {
    blockers.push({ gate: "active_test_order_exists", stage: "TEST_CART_CREATE" })
  }
  if (snapshot.duplicate_gate.active_partial_cart_count > 0) {
    blockers.push({ gate: "active_partial_test_cart_exists", stage: "TEST_CART_CREATE" })
  }
  const estimatedMutations = stages.reduce((sum, s) => sum + s.estimated_mutations, 0)

  let decision: CheckoutTestDecision = "CHECKOUT_TEST_ORDER_DRY_RUN_READY"
  const errors: string[] = []
  if (blockers.length > 0) {
    decision = "CHECKOUT_TEST_ORDER_BLOCKED"
    for (const b of blockers) errors.push(`blocked:${b.stage}:${b.gate}`)
  }

  let fingerprintPayload: CheckoutTestFingerprintPayload | null = null
  let planFingerprint: string | null = null
  if (decision === "CHECKOUT_TEST_ORDER_DRY_RUN_READY") {
    fingerprintPayload = {
      policy_version: CHECKOUT_TEST_ORDER_POLICY_VERSION,
      region_id: snapshot.region_id,
      sales_channel_id: snapshot.sales_channel_id,
      publishable_key_identity: snapshot.publishable_key_identity,
      product_id: snapshot.product?.id ?? null,
      variant_id: snapshot.product?.variant_id ?? null,
      sku: snapshot.product?.sku ?? null,
      quantity: QUANTITY,
      unit_price: snapshot.product?.unit_price ?? null,
      manage_inventory: snapshot.product?.manage_inventory ?? null,
      shipping_option_id: snapshot.shipping_option?.id ?? null,
      shipping_amount: snapshot.shipping_option?.amount ?? null,
      payment_provider_id: snapshot.payment_provider?.id ?? null,
      test_email: TEST_EMAIL,
      country_code: COUNTRY_CODE,
      address_signature: addressSignature({ ...TEST_ADDRESS }),
      expected_subtotal: totals.subtotal,
      expected_shipping_total: totals.shipping_total,
      expected_tax_total: totals.tax_total,
      expected_grand_total: totals.grand_total,
      planned_actions: stages.map((s) => ({ stage: s.stage, status: s.status })),
      execution_strategy_version: EXECUTION_STRATEGY_VERSION,
      mutation_sequence: [...MUTATION_SEQUENCE],
      duplicate_order_gate: {
        active_test_order_count: snapshot.duplicate_gate.active_test_order_count,
        active_partial_cart_count: snapshot.duplicate_gate.active_partial_cart_count,
        gate_version: DUPLICATE_GATE_VERSION,
        marker: snapshot.duplicate_gate.marker,
      },
      pre_complete_gate_version: PRE_COMPLETE_GATE_VERSION,
      recovery_strategy_version: RECOVERY_STRATEGY_VERSION,
      selected_inventory_location_candidates: snapshot.inventory_location_candidates
        .filter((c) => c.in_sales_channel && c.available > 0)
        .map((c) => c.location_id)
        .sort(),
      cancellation_strategy_version: CANCELLATION_STRATEGY_VERSION,
      money_normalization_version: MONEY_NORMALIZATION_VERSION,
      shipping_amount_resolution_strategy: SHIPPING_AMOUNT_RESOLUTION_STRATEGY,
      cart_total_consistency_gate_version: CART_TOTAL_CONSISTENCY_GATE_VERSION,
    }
    planFingerprint = computeCheckoutTestFingerprint(fingerprintPayload)
  }

  return {
    stages,
    totals,
    blockers,
    fingerprint_payload: fingerprintPayload,
    plan_fingerprint: planFingerprint,
    estimated_mutations: estimatedMutations,
    cancellation_plan: CANCELLATION_PLAN,
    decision,
    errors,
  }
}
