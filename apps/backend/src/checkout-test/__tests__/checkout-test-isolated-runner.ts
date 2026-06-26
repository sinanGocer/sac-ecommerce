/* eslint-disable no-console */
import assert from "assert"

import {
  computeCheckoutTestFingerprint,
  isCheckoutTestConfirmationValid,
  CheckoutTestFingerprintPayload,
} from "../checkout-test-fingerprint"
import {
  computeExpectedTotals,
  evaluateCostGate,
  evaluatePreComplete,
  CartStateForComplete,
  PreCompleteExpected,
} from "../checkout-test-plan"
import {
  CHECKOUT_TEST_ORDER_POLICY_VERSION,
  CheckoutTestSnapshot,
  EXPECTED_PRODUCT,
  EXPECTED_SHIPPING,
  PAYMENT_PROVIDER_ID,
  TEST_EMAIL,
} from "../checkout-test-policy"
import { planCheckoutTest } from "../checkout-test-service"

/** jest'siz izole test runner. Çalıştırma: npm run checkout:test-order:test */
let passed = 0
function ok(cond: unknown, label: string): void {
  assert.ok(cond, label)
  passed++
}

function validSnapshot(): CheckoutTestSnapshot {
  return {
    region_id: "reg_tr",
    region_currency: "try",
    region_countries: ["tr"],
    sales_channel_id: "sc_def",
    sales_channel_name: "Default Sales Channel",
    publishable_key_identity: "apk_1",
    tax_rate: 0,
    product: {
      id: EXPECTED_PRODUCT.product_id,
      status: "published",
      in_sales_channel: true,
      variant_id: EXPECTED_PRODUCT.variant_id,
      sku: EXPECTED_PRODUCT.sku,
      unit_price: 169,
      currency: "try",
      manage_inventory: true,
      variant_count: 1,
      reservable_quantity: 1000,
      shipping_profile_id: "sp_def",
    },
    shipping_option: {
      id: EXPECTED_SHIPPING.option_id,
      name: "Türkiye Standart Kargo",
      provider_id: "manual_manual",
      amount: 59,
      currency: "try",
      service_zone_name: "Türkiye",
      is_europe: false,
    },
    payment_provider: { id: PAYMENT_PROVIDER_ID, is_enabled: true },
  }
}

function clone(mut: (s: CheckoutTestSnapshot) => void): CheckoutTestSnapshot {
  const s = validSnapshot()
  mut(s)
  return s
}

function preExpected(): PreCompleteExpected {
  return {
    email: TEST_EMAIL,
    variant_id: EXPECTED_PRODUCT.variant_id,
    quantity: 1,
    unit_price: 169,
    shipping_option_id: EXPECTED_SHIPPING.option_id,
    shipping_amount: 59,
    country_code: "tr",
    payment_provider_id: PAYMENT_PROVIDER_ID,
    grand_total: 228,
  }
}
function validCartState(): CartStateForComplete {
  return {
    created_by_this_run: true,
    email: TEST_EMAIL,
    item_count: 1,
    line: { variant_id: EXPECTED_PRODUCT.variant_id, quantity: 1, unit_price: 169 },
    shipping_option_id: EXPECTED_SHIPPING.option_id,
    shipping_amount: 59,
    country_code: "tr",
    payment_provider_id: PAYMENT_PROVIDER_ID,
    completed_at: null,
    order_reference_count: 0,
    total: 228,
  }
}

function noSqlGuard(): void {
  const fs = require("fs") as typeof import("fs")
  const path = require("path") as typeof import("path")
  const dir = path.resolve(process.cwd(), "src", "checkout-test")
  const sqlPattern = /\b(SELECT|INSERT|UPDATE|DELETE|DROP)\s+.*\b(FROM|INTO|TABLE|WHERE|SET)\b/i
  for (const file of fs.readdirSync(dir).filter((f: string) => f.endsWith(".ts"))) {
    ok(!sqlPattern.test(fs.readFileSync(path.join(dir, file), "utf-8")), `no raw SQL in ${file}`)
  }
  const script = fs.readFileSync(path.resolve(process.cwd(), "src", "scripts", "checkout-test-order.ts"), "utf-8")
  ok(!sqlPattern.test(script), "no raw SQL in checkout-test-order.ts")
  ok(/query\.graph/.test(script), "script uses Medusa public layer")
}

function main(): void {
  // 1) Published + satın alınabilir → ready
  const happy = planCheckoutTest(validSnapshot())
  ok(
    happy.decision === "CHECKOUT_TEST_ORDER_DRY_RUN_READY" &&
      happy.plan_fingerprint !== null &&
      happy.totals.subtotal === 169 &&
      happy.totals.shipping_total === 59 &&
      happy.totals.tax_total === 0 &&
      happy.totals.grand_total === 228,
    "1 happy plan + totals"
  )

  // 2) Draft ürün → blocked
  ok(planCheckoutTest(clone((s) => { s.product!.status = "draft" })).decision === "CHECKOUT_TEST_ORDER_BLOCKED", "2 draft blocked")
  // 3) Sales channel dışı → blocked
  ok(planCheckoutTest(clone((s) => { s.product!.in_sales_channel = false })).decision === "CHECKOUT_TEST_ORDER_BLOCKED", "3 not in sales channel blocked")
  // 4) Variant fiyatı yok → blocked
  ok(planCheckoutTest(clone((s) => { s.product!.unit_price = null })).decision === "CHECKOUT_TEST_ORDER_BLOCKED", "4 no price blocked")
  // 5) Yanlış currency → blocked
  ok(planCheckoutTest(clone((s) => { s.product!.currency = "usd" })).decision === "CHECKOUT_TEST_ORDER_BLOCKED", "5 wrong currency blocked")
  // 6) Quantity 1'e kilitli (plan her zaman quantity 1 üretir)
  {
    const line = happy.stages.find((x) => x.stage === "LINE_ITEM_ADD")
    ok((line?.detail as any)?.quantity === 1, "6 quantity locked to 1")
  }
  // 7) Shipping option yok → blocked
  ok(planCheckoutTest(clone((s) => { s.shipping_option = null })).decision === "CHECKOUT_TEST_ORDER_BLOCKED", "7 no shipping option blocked")
  // 8) Shipping amount 59 değil → blocked
  ok(planCheckoutTest(clone((s) => { s.shipping_option!.amount = 99 })).decision === "CHECKOUT_TEST_ORDER_BLOCKED", "8 shipping amount drift blocked")
  // 9) Europe shipping option → blocked
  ok(planCheckoutTest(clone((s) => { s.shipping_option!.is_europe = true; s.shipping_option!.service_zone_name = "Europe" })).decision === "CHECKOUT_TEST_ORDER_BLOCKED", "9 europe option blocked")
  // 10) Payment provider farklı → blocked
  ok(planCheckoutTest(clone((s) => { s.payment_provider!.id = "pp_stripe_stripe" })).decision === "CHECKOUT_TEST_ORDER_BLOCKED", "10 wrong payment provider blocked")
  // 11) Test email exact (fingerprint payload)
  ok(happy.fingerprint_payload?.test_email === TEST_EMAIL && /@invalid\.example$/.test(TEST_EMAIL), "11 exact test email")
  // 12) Country tr değil → blocked
  ok(planCheckoutTest(clone((s) => { s.region_countries = ["de"] })).decision === "CHECKOUT_TEST_ORDER_BLOCKED", "12 country not tr blocked")
  // 13) Total max aşımı → cost gate blocked
  {
    const totals = { subtotal: 9999, shipping_total: 59, tax_total: 0, grand_total: 10058 }
    ok(!evaluateCostGate(totals).ok, "13 total exceeds max blocked")
  }
  // 14) Dry-run mutation executed false
  ok(happy.stages.every((s) => s.executed === false), "14 dry-run no execution")
  // 15) Yanlış token reddedilir
  ok(
    !isCheckoutTestConfirmationValid("wrong", happy.plan_fingerprint!) &&
      !isCheckoutTestConfirmationValid(null, happy.plan_fingerprint!) &&
      isCheckoutTestConfirmationValid(happy.plan_fingerprint!, happy.plan_fingerprint!),
    "15 confirm token"
  )

  // 16-19) fingerprint determinism + sensitivity
  const payload: CheckoutTestFingerprintPayload = happy.fingerprint_payload!
  ok(computeCheckoutTestFingerprint(payload) === computeCheckoutTestFingerprint({ ...payload }), "16 deterministic fp")
  ok(computeCheckoutTestFingerprint(payload) !== computeCheckoutTestFingerprint({ ...payload, unit_price: 170, expected_subtotal: 170, expected_grand_total: 229 }), "17 product price changes fp")
  ok(computeCheckoutTestFingerprint(payload) !== computeCheckoutTestFingerprint({ ...payload, shipping_amount: 79, expected_shipping_total: 79, expected_grand_total: 248 }), "18 shipping price changes fp")
  ok(computeCheckoutTestFingerprint(payload) !== computeCheckoutTestFingerprint({ ...payload, payment_provider_id: "pp_stripe_stripe" }), "19 provider changes fp")
  ok(computeCheckoutTestFingerprint(payload) !== computeCheckoutTestFingerprint({ ...payload, policy_version: 2 }), "19b policy version changes fp")

  // 20) Pre-complete cart drift → blocked (variant)
  ok(!evaluatePreComplete(({ ...validCartState(), line: { variant_id: "var_x", quantity: 1, unit_price: 169 } }), preExpected()).ok, "20 pre-complete variant drift")
  // 21) Ek line item → blocked
  ok(evaluatePreComplete({ ...validCartState(), item_count: 2 }, preExpected()).blockers.includes("item_count_not_1"), "21 extra line item")
  // 22) Quantity drift → blocked
  ok(evaluatePreComplete({ ...validCartState(), line: { variant_id: EXPECTED_PRODUCT.variant_id, quantity: 2, unit_price: 169 }, total: 397 }, preExpected()).blockers.includes("quantity_drift"), "22 quantity drift")
  // 23) Shipping method drift → blocked
  ok(evaluatePreComplete({ ...validCartState(), shipping_option_id: "so_other" }, preExpected()).blockers.includes("shipping_method_drift"), "23 shipping method drift")
  // 24) completed cart → blocked
  ok(evaluatePreComplete({ ...validCartState(), completed_at: "2026-06-26T00:00:00Z" }, preExpected()).blockers.includes("cart_already_completed"), "24 completed cart")
  // 25) order reference mevcut → blocked
  ok(evaluatePreComplete({ ...validCartState(), order_reference_count: 1 }, preExpected()).blockers.includes("order_reference_exists"), "25 order reference exists")
  // 25b) valid cart state → ok
  ok(evaluatePreComplete(validCartState(), preExpected()).ok, "25b valid pre-complete ok")

  // 26) Raw SQL yok
  noSqlGuard()

  // 27) Report actual mutations 0 (dry-run) — estimated > 0 ama executed false
  ok(happy.estimated_mutations > 0 && happy.stages.every((s) => s.executed === false), "27 estimated>0 but no execution")

  // 28) Gerçek email/telefon kullanılmıyor (invalid TLD)
  ok(/@invalid\.example$/.test(TEST_EMAIL), "28 non-deliverable test email")

  // 29) Existing cart kullanılmıyor — TEST_CART_CREATE yeni cart oluşturur (mutation)
  {
    const create = happy.stages.find((s) => s.stage === "TEST_CART_CREATE")
    ok(create?.kind === "mutation", "29 new cart create stage (no existing cart reuse)")
  }

  // 30) Cancel planı order delete önermiyor
  ok(
    happy.cancellation_plan.order_delete === false &&
      !happy.cancellation_plan.steps.some((s) => /sil|delete/i.test(s)),
    "30 cancel plan no order delete"
  )

  // ek) totals helper deterministik (tax_rate 0)
  ok(computeExpectedTotals(validSnapshot()).grand_total === 228, "ek totals 228")

  console.log(`CHECKOUT TEST ORDER ISOLATED TESTS: ${passed} PASSED`)
}

try {
  main()
} catch (e) {
  console.error("CHECKOUT TEST FAILED:", e instanceof Error ? e.message : e)
  process.exit(1)
}
