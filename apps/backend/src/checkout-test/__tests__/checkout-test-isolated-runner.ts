/* eslint-disable no-console */
import assert from "assert"

import {
  computeCheckoutTestFingerprint,
  isCheckoutTestConfirmationValid,
  CheckoutTestFingerprintPayload,
} from "../checkout-test-fingerprint"
import {
  ExecutionDeps,
  executeCheckoutTestOrder,
} from "../checkout-test-executor"
import {
  checkCartTotalsConsistency,
  normalizeMoney,
  resolveShippingAmount,
} from "../money"
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
    inventory_location_candidates: [
      { location_id: "sloc_eu", name: "European Warehouse", available: 1000, in_sales_channel: true },
      { location_id: "sloc_tr", name: "Türkiye Deposu", available: 0, in_sales_channel: true },
    ],
    duplicate_gate: {
      active_test_order_count: 0,
      active_test_order_ids: [],
      active_partial_cart_count: 0,
      active_partial_cart_ids: [],
      marker: "none",
    },
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

async function main(): Promise<void> {
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
  ok(computeCheckoutTestFingerprint(payload) !== computeCheckoutTestFingerprint({ ...payload, policy_version: 99 }), "19b policy version changes fp")
  // v2 execution path alanları fingerprint'i etkiler
  ok(computeCheckoutTestFingerprint(payload) !== computeCheckoutTestFingerprint({ ...payload, execution_strategy_version: 2 }), "19c execution strategy changes fp")
  ok(computeCheckoutTestFingerprint(payload) !== computeCheckoutTestFingerprint({ ...payload, selected_inventory_location_candidates: ["sloc_x"] }), "19d inventory candidates change fp")

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

  // policy v4 doğrulaması
  ok(CHECKOUT_TEST_ORDER_POLICY_VERSION === 4, "policy version is 4")
  // eski v2/v3 fingerprint'leri artık üretilmez (yeni payload alanları)
  ok(
    happy.plan_fingerprint !== "6c53ef4e763cd4b7" && happy.plan_fingerprint !== "2dcfb319e16dfbb7",
    "old v2/v3 fingerprints invalidated"
  )
  // Aktif partial test cart → yeni execution bloklanır (duplicate gate v2)
  {
    const s = validSnapshot()
    s.duplicate_gate.active_partial_cart_count = 1
    s.duplicate_gate.active_partial_cart_ids = ["cart_partial_1"]
    const p = planCheckoutTest(s)
    ok(
      p.decision === "CHECKOUT_TEST_ORDER_BLOCKED" &&
        p.blockers.some((b) => b.gate === "active_partial_test_cart_exists"),
      "duplicate gate blocks on active partial cart"
    )
  }

  // ── Money normalization (BigNumber/string/null) ───────────────────────────
  runMoneyTests()

  // ── Commit execution (fake adapter; canlı mutation YOK) ───────────────────
  await runExecutorAsync()

  console.log(`CHECKOUT TEST ORDER ISOLATED TESTS: ${passed} PASSED`)
}

// ── Money normalization tests ─────────────────────────────────────────────────

/** BigNumber benzeri sahte nesneler. */
const bnValueOf = (n: number) => ({ valueOf: () => n })
const bnToNumber = (n: number) => ({ toNumber: () => n })
const bnToString = (n: number) => ({ toString: () => String(n) })
const bnNumeric = (n: number) => ({ numeric_: n })

function runMoneyTests(): void {
  // 1-8 normalizeMoney
  ok(normalizeMoney(169) === 169, "m1 number")
  ok(normalizeMoney("169") === 169, "m2 numeric string")
  ok(normalizeMoney(bnValueOf(169)) === 169, "m3 BigNumber valueOf")
  ok(normalizeMoney(bnToNumber(169)) === 169, "m4 BigNumber toNumber")
  ok(normalizeMoney(bnToString(169)) === 169, "m5 BigNumber toString")
  ok(normalizeMoney(bnNumeric(169)) === 169, "m5b BigNumber numeric_")
  ok(normalizeMoney(null) === null && normalizeMoney(undefined) === null, "m6 null/undefined")
  ok(normalizeMoney("abc") === null && normalizeMoney({}) === null, "m7 invalid → null")
  ok(normalizeMoney(NaN) === null && normalizeMoney(Infinity) === null, "m8 NaN/Infinity → null")

  // 9-10 unit price drift via pre-complete (normalize edilmiş değerle)
  ok(evaluatePreComplete({ ...validCartState(), line: { variant_id: EXPECTED_PRODUCT.variant_id, quantity: 1, unit_price: normalizeMoney(bnValueOf(169)) } }, preExpected()).ok, "m9 BigNumber unit_price no drift")
  ok(evaluatePreComplete({ ...validCartState(), line: { variant_id: EXPECTED_PRODUCT.variant_id, quantity: 1, unit_price: normalizeMoney(bnValueOf(170)) } }, preExpected()).blockers.includes("unit_price_drift"), "m10 real unit price drift detected")

  // 11) method amount null ama cart shipping_total 59 → 59 çözülür
  {
    const r = resolveShippingAmount(bnValueOf(59), null, null)
    ok(r.ok && r.amount === 59, "m11 shipping resolved from cart total")
  }
  // 12) cart shipping_total 59 vs method amount 79 → conflict block
  {
    const r = resolveShippingAmount(bnValueOf(59), null, bnValueOf(79))
    ok(!r.ok && r.reason === "shipping_source_conflict", "m12 shipping source conflict blocks")
  }
  // 12b) ikisi de null → unresolved
  ok(!resolveShippingAmount(null, null, null).ok, "m12b shipping unresolved")
  // 12c) tutarlı kaynaklar → ok
  ok(resolveShippingAmount(bnValueOf(59), bnValueOf(59), bnValueOf(59)).amount === 59, "m12c consistent shipping ok")

  // 13-14) cart total arithmetic consistency
  {
    const good = checkCartTotalsConsistency({ item_total: bnValueOf(169), shipping_total: bnValueOf(59), tax_total: bnValueOf(0), discount_total: bnValueOf(0), total: bnValueOf(228) })
    ok(good.ok && good.normalized.total === 228, "m13 totals consistent")
    const bad = checkCartTotalsConsistency({ item_total: bnValueOf(169), shipping_total: bnValueOf(59), tax_total: bnValueOf(0), discount_total: bnValueOf(0), total: bnValueOf(999) })
    ok(!bad.ok && bad.reason === "total_arithmetic_mismatch", "m14 total arithmetic mismatch blocked")
  }
  // 15) discount drift breaks arithmetic
  ok(!checkCartTotalsConsistency({ item_total: 169, shipping_total: 59, tax_total: 0, discount_total: 10, total: 228 }).ok, "m15 discount drift blocked")
  // 16) tax drift breaks arithmetic
  ok(!checkCartTotalsConsistency({ item_total: 169, shipping_total: 59, tax_total: 18, discount_total: 0, total: 228 }).ok, "m16 tax drift blocked")
  // 17) unparseable money → block
  ok(!checkCartTotalsConsistency({ item_total: "x", shipping_total: 59, tax_total: 0, discount_total: 0, total: 228 }).ok, "m17 unparseable money blocked")
}

// ── Fake execution deps ───────────────────────────────────────────────────────

interface FakeOptions {
  duplicate?: boolean
  failAt?: string
  preCompleteState?: Partial<CartStateForComplete>
  completeReturnsCart?: boolean
  readBackFails?: boolean
  providerOverride?: string
}

function fakeDeps(calls: string[], opt: FakeOptions = {}): ExecutionDeps {
  const boom = (stage: string) => {
    if (opt.failAt === stage) throw new Error(`fail:${stage}`)
  }
  return {
    findActiveDuplicateTestOrder: async () => {
      calls.push("dup")
      return { exists: !!opt.duplicate, order_ids: opt.duplicate ? ["order_existing"] : [] }
    },
    createCart: async () => { calls.push("createCart"); boom("createCart"); return { cart_id: "cart_1" } },
    addLineItem: async () => { calls.push("addLineItem"); boom("addLineItem"); return { line_item_id: "li_1" } },
    setEmailAndAddress: async () => { calls.push("setEmailAndAddress"); boom("setEmailAndAddress") },
    addShippingMethod: async () => { calls.push("addShippingMethod"); boom("addShippingMethod"); return { shipping_method_id: "sm_1" } },
    initPaymentSession: async () => {
      calls.push("initPaymentSession"); boom("initPaymentSession")
      return { payment_collection_id: "pc_1", payment_session_id: "ps_1", provider_id: opt.providerOverride ?? PAYMENT_PROVIDER_ID, status: "pending" }
    },
    retrieveCartForComplete: async () => {
      calls.push("retrieve")
      return { ...validCartState(), ...(opt.preCompleteState ?? {}) }
    },
    completeCart: async () => {
      calls.push("completeCart"); boom("completeCart")
      return opt.completeReturnsCart ? { type: "cart" as const, order_id: null } : { type: "order" as const, order_id: "order_1" }
    },
    retrieveOrder: async () => {
      calls.push("retrieveOrder")
      if (opt.readBackFails) throw new Error("read-back fail")
      return {
        id: "order_1", display_id: 1, email: TEST_EMAIL, currency_code: "try", item_count: 1,
        variant_ids: [EXPECTED_PRODUCT.variant_id], item_subtotal: 169, shipping_total: 59, tax_total: 0,
        grand_total: 228, shipping_country: "tr", status: "pending", payment_status: "authorized",
        fulfillment_status: "not_fulfilled", metadata: { test_order: true },
      }
    },
  }
}

function expectedForExec(): PreCompleteExpected & { payment_provider_id: string } {
  return { ...preExpected(), payment_provider_id: PAYMENT_PROVIDER_ID }
}

async function runExecutorAsync(): Promise<void> {
  // ex1) Doğru akış → COMMITTED, sıra doğru, complete tek kez
  {
    const calls: string[] = []
    const r = await executeCheckoutTestOrder(fakeDeps(calls), expectedForExec())
    ok(
      r.decision === "EXECUTION_COMMITTED" &&
        r.mutation_sequence.join(",") === "TEST_CART_CREATE,LINE_ITEM_ADD,EMAIL_AND_ADDRESS_SET,SHIPPING_METHOD_ADD,PAYMENT_COLLECTION_CREATE,PAYMENT_SESSION_INITIALIZE,CART_COMPLETE" &&
        calls.filter((c) => c === "completeCart").length === 1 &&
        r.created_ids.order_id === "order_1" &&
        r.actual_mutations === 7,
      "ex1 full chain committed, complete once, ids recorded"
    )
  }
  // ex2) Duplicate → cart create yok
  {
    const calls: string[] = []
    const r = await executeCheckoutTestOrder(fakeDeps(calls, { duplicate: true }), expectedForExec())
    ok(r.decision === "EXECUTION_DUPLICATE_BLOCKED" && !calls.includes("createCart") && r.actual_mutations === 0, "ex2 duplicate blocks create")
  }
  // ex3) createCart fail → sonraki yok
  {
    const calls: string[] = []
    const r = await executeCheckoutTestOrder(fakeDeps(calls, { failAt: "createCart" }), expectedForExec())
    ok(r.decision === "EXECUTION_PARTIAL_FAILURE" && !calls.includes("addLineItem") && !calls.includes("completeCart"), "ex3 cart create fail aborts")
  }
  // ex4) addLineItem fail → complete yok
  {
    const calls: string[] = []
    const r = await executeCheckoutTestOrder(fakeDeps(calls, { failAt: "addLineItem" }), expectedForExec())
    ok(r.partial_failure?.stage === "LINE_ITEM_ADD" && !calls.includes("completeCart"), "ex4 line add fail no complete")
  }
  // ex5) address fail → complete yok
  {
    const calls: string[] = []
    await executeCheckoutTestOrder(fakeDeps(calls, { failAt: "setEmailAndAddress" }), expectedForExec())
    ok(!calls.includes("completeCart"), "ex5 address fail no complete")
  }
  // ex6) shipping fail → payment/complete yok
  {
    const calls: string[] = []
    await executeCheckoutTestOrder(fakeDeps(calls, { failAt: "addShippingMethod" }), expectedForExec())
    ok(!calls.includes("initPaymentSession") && !calls.includes("completeCart"), "ex6 shipping fail no payment/complete")
  }
  // ex7) payment init fail → complete yok
  {
    const calls: string[] = []
    await executeCheckoutTestOrder(fakeDeps(calls, { failAt: "initPaymentSession" }), expectedForExec())
    ok(!calls.includes("completeCart"), "ex7 payment fail no complete")
  }
  // ex8) provider drift → complete yok
  {
    const calls: string[] = []
    const r = await executeCheckoutTestOrder(fakeDeps(calls, { providerOverride: "pp_stripe_stripe" }), expectedForExec())
    ok(!calls.includes("completeCart") && /provider_mismatch/.test(r.partial_failure?.error ?? ""), "ex8 provider drift no complete")
  }
  // ex9) pre-complete drift (extra line) → complete çağrısı 0
  {
    const calls: string[] = []
    const r = await executeCheckoutTestOrder(fakeDeps(calls, { preCompleteState: { item_count: 2 } }), expectedForExec())
    ok(r.decision === "EXECUTION_PRE_COMPLETE_BLOCKED" && !calls.includes("completeCart"), "ex9 extra line drift no complete")
  }
  // ex10) total drift → complete yok
  {
    const calls: string[] = []
    await executeCheckoutTestOrder(fakeDeps(calls, { preCompleteState: { total: 999 } }), expectedForExec())
    ok(!calls.includes("completeCart"), "ex10 total drift no complete")
  }
  // ex11) quantity drift → complete yok
  {
    const calls: string[] = []
    await executeCheckoutTestOrder(fakeDeps(calls, { preCompleteState: { line: { variant_id: EXPECTED_PRODUCT.variant_id, quantity: 3, unit_price: 169 } } }), expectedForExec())
    ok(!calls.includes("completeCart"), "ex11 quantity drift no complete")
  }
  // ex12) completed cart drift → complete yok
  {
    const calls: string[] = []
    await executeCheckoutTestOrder(fakeDeps(calls, { preCompleteState: { completed_at: "2026-01-01" } }), expectedForExec())
    ok(!calls.includes("completeCart"), "ex12 completed drift no complete")
  }
  // ex13) complete order döndürmedi → partial, retry yok
  {
    const calls: string[] = []
    const r = await executeCheckoutTestOrder(fakeDeps(calls, { completeReturnsCart: true }), expectedForExec())
    ok(r.decision === "EXECUTION_PARTIAL_FAILURE" && calls.filter((c) => c === "completeCart").length === 1 && !calls.includes("retrieveOrder"), "ex13 complete no order partial, no retry")
  }
  // ex14) read-back fail → partial verification, complete tekrar yok
  {
    const calls: string[] = []
    const r = await executeCheckoutTestOrder(fakeDeps(calls, { readBackFails: true }), expectedForExec())
    ok(r.decision === "EXECUTION_PARTIAL_VERIFICATION" && calls.filter((c) => c === "completeCart").length === 1 && r.created_ids.order_id === "order_1", "ex14 read-back fail partial verification")
  }
  // ex15) complete fail → partial, kör retry yok
  {
    const calls: string[] = []
    const r = await executeCheckoutTestOrder(fakeDeps(calls, { failAt: "completeCart" }), expectedForExec())
    ok(r.decision === "EXECUTION_PARTIAL_FAILURE" && calls.filter((c) => c === "completeCart").length === 1, "ex15 complete fail no blind retry")
  }
}

main().catch((e: unknown) => {
  console.error("CHECKOUT TEST FAILED:", e instanceof Error ? e.message : e)
  process.exit(1)
})
