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
  CHECKOUT_TEST_ORDER_POLICY_VERSION,
  CheckoutTestDecision,
  CheckoutTestSnapshot,
  COUNTRY_CODE,
  ExpectedTotals,
  QUANTITY,
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
