/**
 * Checkout Test Order — SAF plan mantığı (IO yok, deterministik).
 *
 * Resolve gate'leri (ürün/shipping/payment) + 12 aşamalı plan + beklenen totals
 * + maliyet sınırı. Dry-run'da mutation aşamaları planned/executed=false.
 */

import {
  CHECKOUT_TEST_ORDER_POLICY_VERSION,
  CheckoutTestSnapshot,
  COUNTRY_CODE,
  CURRENCY,
  EXPECTED_PRODUCT,
  EXPECTED_SHIPPING,
  ExpectedTotals,
  MAX_ITEM_SUBTOTAL,
  MAX_ORDER_TOTAL,
  MAX_SHIPPING_AMOUNT,
  PAYMENT_PROVIDER_ID,
  QUANTITY,
  StageResult,
} from "./checkout-test-policy"

export interface GateOutcome {
  ok: boolean
  gate: string | null
  detail: Record<string, unknown>
}

export function evaluateProductGate(snap: CheckoutTestSnapshot): GateOutcome {
  const p = snap.product
  const detail: Record<string, unknown> = { product: p }
  if (!p) return { ok: false, gate: "product_not_found", detail }
  if (p.id !== EXPECTED_PRODUCT.product_id) return { ok: false, gate: "product_id_mismatch", detail }
  if (p.status !== "published") return { ok: false, gate: "product_not_published", detail }
  if (!p.in_sales_channel) return { ok: false, gate: "product_not_in_sales_channel", detail }
  if (p.variant_id !== EXPECTED_PRODUCT.variant_id) return { ok: false, gate: "variant_mismatch", detail }
  if (p.sku !== EXPECTED_PRODUCT.sku) return { ok: false, gate: "sku_mismatch", detail }
  if (p.variant_count !== EXPECTED_PRODUCT.variant_count) return { ok: false, gate: "variant_count_changed", detail }
  if (p.currency !== CURRENCY) return { ok: false, gate: "wrong_currency", detail }
  if (p.unit_price === null) return { ok: false, gate: "no_variant_price", detail }
  if (p.unit_price !== EXPECTED_PRODUCT.unit_price) return { ok: false, gate: "unit_price_drift", detail }
  return { ok: true, gate: null, detail }
}

export function evaluateShippingGate(snap: CheckoutTestSnapshot): GateOutcome {
  const o = snap.shipping_option
  const detail: Record<string, unknown> = { shipping_option: o }
  if (!o) return { ok: false, gate: "shipping_option_not_found", detail }
  if (o.is_europe) return { ok: false, gate: "europe_shipping_option_rejected", detail }
  if (o.id !== EXPECTED_SHIPPING.option_id) return { ok: false, gate: "shipping_option_id_mismatch", detail }
  if (o.provider_id !== EXPECTED_SHIPPING.provider_id) return { ok: false, gate: "shipping_provider_mismatch", detail }
  if (o.service_zone_name !== EXPECTED_SHIPPING.service_zone_name) return { ok: false, gate: "shipping_zone_mismatch", detail }
  if (o.currency !== null && o.currency !== CURRENCY) return { ok: false, gate: "shipping_wrong_currency", detail }
  if (o.amount !== EXPECTED_SHIPPING.amount) return { ok: false, gate: "shipping_amount_drift", detail }
  return { ok: true, gate: null, detail }
}

export function evaluatePaymentGate(snap: CheckoutTestSnapshot): GateOutcome {
  const pp = snap.payment_provider
  const detail: Record<string, unknown> = { payment_provider: pp }
  if (!pp) return { ok: false, gate: "payment_provider_not_found", detail }
  if (pp.id !== PAYMENT_PROVIDER_ID) return { ok: false, gate: "payment_provider_mismatch", detail }
  if (!pp.is_enabled) return { ok: false, gate: "payment_provider_disabled", detail }
  return { ok: true, gate: null, detail }
}

export function evaluateRegionGate(snap: CheckoutTestSnapshot): GateOutcome {
  const detail = { region_id: snap.region_id, countries: snap.region_countries }
  if (!snap.region_id) return { ok: false, gate: "region_not_found", detail }
  if (!snap.region_countries.includes(COUNTRY_CODE)) return { ok: false, gate: "country_not_supported", detail }
  if (snap.region_currency !== CURRENCY) return { ok: false, gate: "region_wrong_currency", detail }
  if (!snap.sales_channel_id) return { ok: false, gate: "sales_channel_unresolved", detail }
  return { ok: true, gate: null, detail }
}

export function computeExpectedTotals(snap: CheckoutTestSnapshot): ExpectedTotals {
  const unit = snap.product?.unit_price ?? EXPECTED_PRODUCT.unit_price
  const ship = snap.shipping_option?.amount ?? EXPECTED_SHIPPING.amount
  const subtotal = unit * QUANTITY
  const shipping_total = ship
  const tax_total = Math.round((subtotal + shipping_total) * snap.tax_rate)
  return {
    subtotal,
    shipping_total,
    tax_total,
    grand_total: subtotal + shipping_total + tax_total,
  }
}

export function evaluateCostGate(totals: ExpectedTotals): GateOutcome {
  const detail = { totals, max_item_subtotal: MAX_ITEM_SUBTOTAL, max_shipping: MAX_SHIPPING_AMOUNT, max_total: MAX_ORDER_TOTAL }
  if (totals.subtotal > MAX_ITEM_SUBTOTAL) return { ok: false, gate: "subtotal_exceeds_max", detail }
  if (totals.shipping_total > MAX_SHIPPING_AMOUNT) return { ok: false, gate: "shipping_exceeds_max", detail }
  if (totals.grand_total > MAX_ORDER_TOTAL) return { ok: false, gate: "total_exceeds_max", detail }
  return { ok: true, gate: null, detail }
}

export interface PlanEvaluation {
  stages: StageResult[]
  totals: ExpectedTotals
  blockers: Array<{ gate: string; stage: string }>
}

export function evaluateCheckoutTestStages(
  snap: CheckoutTestSnapshot
): PlanEvaluation {
  const productGate = evaluateProductGate(snap)
  const shippingGate = evaluateShippingGate(snap)
  const paymentGate = evaluatePaymentGate(snap)
  const regionGate = evaluateRegionGate(snap)
  const totals = computeExpectedTotals(snap)
  const costGate = evaluateCostGate(totals)

  const blockers: Array<{ gate: string; stage: string }> = []
  const pushBlock = (g: GateOutcome, stage: string): void => {
    if (!g.ok && g.gate) blockers.push({ gate: g.gate, stage })
  }
  pushBlock(regionGate, "PRODUCT_AND_VARIANT_RESOLVE")
  pushBlock(productGate, "PRODUCT_AND_VARIANT_RESOLVE")
  pushBlock(shippingGate, "SHIPPING_OPTION_RESOLVE")
  pushBlock(paymentGate, "PAYMENT_PROVIDER_RESOLVE")
  pushBlock(costGate, "PRE_COMPLETE_REVALIDATE")

  const anyResolveBlocked = !productGate.ok || !shippingGate.ok || !paymentGate.ok || !regionGate.ok || !costGate.ok
  const mut = (m: number): number => (anyResolveBlocked ? 0 : m)
  const mutStatus = anyResolveBlocked ? "blocked" : "planned"

  const stages: StageResult[] = [
    {
      stage: "PRODUCT_AND_VARIANT_RESOLVE",
      kind: "resolve",
      status: productGate.ok && regionGate.ok ? "ready" : "blocked",
      executed: false,
      estimated_mutations: 0,
      detail: { ...productGate.detail, region: regionGate.detail },
      gate: productGate.gate ?? regionGate.gate,
    },
    {
      stage: "SHIPPING_OPTION_RESOLVE",
      kind: "resolve",
      status: shippingGate.ok ? "ready" : "blocked",
      executed: false,
      estimated_mutations: 0,
      detail: shippingGate.detail,
      gate: shippingGate.gate,
    },
    {
      stage: "PAYMENT_PROVIDER_RESOLVE",
      kind: "resolve",
      status: paymentGate.ok ? "ready" : "blocked",
      executed: false,
      estimated_mutations: 0,
      detail: paymentGate.detail,
      gate: paymentGate.gate,
    },
    { stage: "TEST_CART_CREATE", kind: "mutation", status: mutStatus, executed: false, estimated_mutations: mut(1), detail: {}, gate: null },
    { stage: "LINE_ITEM_ADD", kind: "mutation", status: mutStatus, executed: false, estimated_mutations: mut(1), detail: { quantity: QUANTITY, variant_id: EXPECTED_PRODUCT.variant_id }, gate: null },
    { stage: "EMAIL_AND_ADDRESS_SET", kind: "mutation", status: mutStatus, executed: false, estimated_mutations: mut(1), detail: { email: "test", country: COUNTRY_CODE }, gate: null },
    { stage: "SHIPPING_METHOD_ADD", kind: "mutation", status: mutStatus, executed: false, estimated_mutations: mut(1), detail: { option_id: EXPECTED_SHIPPING.option_id, amount: EXPECTED_SHIPPING.amount }, gate: null },
    { stage: "PAYMENT_COLLECTION_CREATE", kind: "mutation", status: mutStatus, executed: false, estimated_mutations: mut(1), detail: {}, gate: null },
    { stage: "PAYMENT_SESSION_INITIALIZE", kind: "mutation", status: mutStatus, executed: false, estimated_mutations: mut(1), detail: { provider_id: PAYMENT_PROVIDER_ID }, gate: null },
    { stage: "PRE_COMPLETE_REVALIDATE", kind: "verify", status: anyResolveBlocked ? "blocked" : "planned", executed: false, estimated_mutations: 0, detail: { totals, cost_gate_ok: costGate.ok }, gate: costGate.gate },
    { stage: "CART_COMPLETE", kind: "mutation", status: mutStatus, executed: false, estimated_mutations: mut(1), detail: {}, gate: null },
    { stage: "ORDER_READ_BACK_VERIFY", kind: "verify", status: anyResolveBlocked ? "blocked" : "planned", executed: false, estimated_mutations: 0, detail: { expected_grand_total: totals.grand_total }, gate: null },
  ]

  return { stages, totals, blockers }
}

export const CHECKOUT_TEST_POLICY_VERSION_REF = CHECKOUT_TEST_ORDER_POLICY_VERSION

// ── Pre-complete revalidation (commit yolundan ÖNCE, SAF) ────────────────────

export interface CartStateForComplete {
  created_by_this_run: boolean
  email: string | null
  item_count: number
  line: { variant_id: string | null; quantity: number | null; unit_price: number | null } | null
  shipping_option_id: string | null
  shipping_amount: number | null
  country_code: string | null
  payment_provider_id: string | null
  completed_at: string | null
  order_reference_count: number
  total: number
}

export interface PreCompleteExpected {
  email: string
  variant_id: string
  quantity: number
  unit_price: number
  shipping_option_id: string
  shipping_amount: number
  country_code: string
  payment_provider_id: string
  grand_total: number
}

/**
 * Cart complete'den HEMEN önce yeniden doğrulama (fail-closed). Herhangi bir
 * uyumsuzlukta complete EDİLMEZ.
 */
export function evaluatePreComplete(
  state: CartStateForComplete,
  expected: PreCompleteExpected
): { ok: boolean; blockers: string[] } {
  const blockers: string[] = []
  if (!state.created_by_this_run) blockers.push("cart_not_created_by_this_run")
  if (state.email !== expected.email) blockers.push("email_mismatch")
  if (state.item_count !== 1) blockers.push("item_count_not_1")
  if (!state.line) blockers.push("line_missing")
  else {
    if (state.line.variant_id !== expected.variant_id) blockers.push("variant_drift")
    if (state.line.quantity !== expected.quantity) blockers.push("quantity_drift")
    if (state.line.unit_price !== expected.unit_price) blockers.push("unit_price_drift")
  }
  if (state.shipping_option_id !== expected.shipping_option_id) blockers.push("shipping_method_drift")
  if (state.shipping_amount !== expected.shipping_amount) blockers.push("shipping_amount_drift")
  if (state.country_code !== expected.country_code) blockers.push("country_drift")
  if (state.payment_provider_id !== expected.payment_provider_id) blockers.push("payment_provider_drift")
  if (state.completed_at !== null) blockers.push("cart_already_completed")
  if (state.order_reference_count > 0) blockers.push("order_reference_exists")
  if (state.total !== expected.grand_total) blockers.push("total_drift")
  return { ok: blockers.length === 0, blockers }
}
