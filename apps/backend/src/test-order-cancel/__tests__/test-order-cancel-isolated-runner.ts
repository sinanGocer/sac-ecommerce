/* eslint-disable no-console */
import assert from "assert"

import {
  computeTestOrderCancelFingerprint,
  isTestOrderCancelConfirmationValid,
  TestOrderCancelFingerprintPayload,
} from "../test-order-cancel-fingerprint"
import {
  ALLOWLISTED_ORDER_ID,
  EXPECTED_ORDER,
  TestOrderSnapshot,
} from "../test-order-cancel-policy"
import { planTestOrderCancel } from "../test-order-cancel-service"

/** jest'siz izole test runner. Çalıştırma: npm run test-order:cancel:test */
let passed = 0
function ok(cond: unknown, label: string): void {
  assert.ok(cond, label)
  passed++
}

function validSnapshot(over: Partial<TestOrderSnapshot> = {}): TestOrderSnapshot {
  return {
    order_id: ALLOWLISTED_ORDER_ID,
    found: true,
    deleted_at: null,
    canceled_at: null,
    status: "pending",
    display_id: 1,
    email: EXPECTED_ORDER.email,
    currency: "try",
    authoritative_total: 228,
    item_count: 1,
    line: { variant_id: EXPECTED_ORDER.variant_id, sku: EXPECTED_ORDER.sku, quantity: 1, unit_price: 169 },
    shipping_method_name: "Türkiye Standart Kargo",
    shipping_amount: 59,
    payment_provider_id: "pp_system_default",
    authorized_amount: 228,
    captured_amount: 0,
    refund_amount: 0,
    payment_status: "authorized",
    fulfillment_count: 0,
    return_count: 0,
    exchange_count: 0,
    claim_count: 0,
    has_test_marker: true,
    reservation_ids: ["resitem_1"],
    reservation_quantity: 1,
    reservation_inventory_item_id: "iitem_1",
    inventory_item_id: "iitem_1",
    inventory_stocked: 1000,
    inventory_reserved: 1,
    active_partial_cart_count: 0,
    other_active_test_order_count: 0,
    ...over,
  }
}

function noSqlGuard(): void {
  const fs = require("fs") as typeof import("fs")
  const path = require("path") as typeof import("path")
  const dir = path.resolve(process.cwd(), "src", "test-order-cancel")
  const sqlPattern = /\b(SELECT|INSERT|UPDATE|DELETE|DROP)\s+.*\b(FROM|INTO|TABLE|WHERE|SET)\b/i
  for (const file of fs.readdirSync(dir).filter((f: string) => f.endsWith(".ts"))) {
    ok(!sqlPattern.test(fs.readFileSync(path.join(dir, file), "utf-8")), `no raw SQL in ${file}`)
  }
  const script = fs.readFileSync(path.resolve(process.cwd(), "src", "scripts", "test-order-cancel.ts"), "utf-8")
  ok(!sqlPattern.test(script), "no raw SQL in test-order-cancel.ts")
  ok(/cancelOrderWorkflow/.test(script), "uses cancelOrderWorkflow")
  ok(!/deleteOrder|hardDelete|\.delete\(/.test(script), "no hard delete call")
}

function main(): void {
  // 1) doğru order → dry-run ready, 3 aksiyon
  const happy = planTestOrderCancel(ALLOWLISTED_ORDER_ID, validSnapshot())
  ok(
    happy.decision === "TEST_ORDER_CANCEL_DRY_RUN_READY" &&
      happy.plan_fingerprint !== null &&
      happy.actions.length === 3 &&
      happy.actions[0].action === "ORDER_CANCEL",
    "1 happy plan"
  )
  // 2) yanlış order ID → blocked
  ok(planTestOrderCancel("order_WRONG", validSnapshot({ order_id: "order_WRONG" })).allowlist.reason === "requested_order_not_allowlisted", "2 wrong order blocked")
  // 3) yanlış display ID → stale
  ok(planTestOrderCancel(ALLOWLISTED_ORDER_ID, validSnapshot({ display_id: 99 })).errors.includes("identity:display_id"), "3 wrong display id stale")
  // 4) yanlış total → stale
  ok(planTestOrderCancel(ALLOWLISTED_ORDER_ID, validSnapshot({ authoritative_total: 999 })).errors.includes("identity:authoritative_total"), "4 wrong total stale")
  // 5) captured payment > 0 → blocked
  {
    const p = planTestOrderCancel(ALLOWLISTED_ORDER_ID, validSnapshot({ captured_amount: 228 }))
    ok(p.decision === "TEST_ORDER_CANCEL_STALE_PLAN" || p.errors.includes("safety:payment_captured") || p.errors.includes("identity:captured_amount"), "5 captured payment blocked")
  }
  // 6) fulfillment varsa → blocked
  ok(planTestOrderCancel(ALLOWLISTED_ORDER_ID, validSnapshot({ fulfillment_count: 1 })).errors.includes("safety:fulfillment_exists"), "6 fulfillment blocked")
  // 7) reservation yoksa → blocked
  {
    const p = planTestOrderCancel(ALLOWLISTED_ORDER_ID, validSnapshot({ reservation_ids: [], reservation_quantity: 0 }))
    ok(p.decision === "TEST_ORDER_CANCEL_STALE_PLAN" || p.errors.includes("safety:reservation_count_not_1") || p.errors.includes("identity:reservation_count"), "7 no reservation blocked")
  }
  // 8) birden fazla reservation → blocked
  ok(planTestOrderCancel(ALLOWLISTED_ORDER_ID, validSnapshot({ reservation_ids: ["r1","r2"], reservation_quantity: 2 })).decision !== "TEST_ORDER_CANCEL_DRY_RUN_READY", "8 multi reservation blocked")
  // 9) test marker yok → blocked
  ok(planTestOrderCancel(ALLOWLISTED_ORDER_ID, validSnapshot({ has_test_marker: false })).errors.includes("safety:missing_test_marker"), "9 no test marker blocked")
  // 10) deterministik fingerprint
  const payload: TestOrderCancelFingerprintPayload = happy.fingerprint_payload!
  ok(computeTestOrderCancelFingerprint(payload) === computeTestOrderCancelFingerprint({ ...payload }), "10 deterministic fp")
  // 11) snapshot değişirse fingerprint farklı (stale temeli)
  ok(computeTestOrderCancelFingerprint(payload) !== computeTestOrderCancelFingerprint({ ...payload, inventory_reserved: 0 }), "11 snapshot change → fp change")
  // 12) yanlış confirmation reddedilir
  ok(!isTestOrderCancelConfirmationValid("x", happy.plan_fingerprint!) && isTestOrderCancelConfirmationValid(happy.plan_fingerprint!, happy.plan_fingerprint!), "12 confirm token")
  // 13) commit flag yoksa mutation yok (dry-run executed false)
  ok(happy.actions.every((a) => a.executed === false), "13 dry-run no execution")
  // 14) cancelled order → idempotent noop
  {
    const p = planTestOrderCancel(ALLOWLISTED_ORDER_ID, validSnapshot({ canceled_at: "2026-06-27", status: "canceled" }))
    ok(p.decision === "TEST_ORDER_CANCEL_IDEMPOTENT_NOOP", "14 cancelled idempotent noop")
  }
  // 15) order not found → blocked
  ok(planTestOrderCancel(ALLOWLISTED_ORDER_ID, validSnapshot({ found: false })).allowlist.reason === "order_not_found", "15 not found blocked")
  // 16) completed order → blocked
  ok(planTestOrderCancel(ALLOWLISTED_ORDER_ID, validSnapshot({ status: "completed" })).errors.includes("safety:order_completed"), "16 completed blocked")
  // 17) active partial cart → blocked
  ok(planTestOrderCancel(ALLOWLISTED_ORDER_ID, validSnapshot({ active_partial_cart_count: 1 })).errors.includes("safety:active_partial_cart_exists"), "17 partial cart blocked")
  // 18) ikinci aktif test order → blocked
  ok(planTestOrderCancel(ALLOWLISTED_ORDER_ID, validSnapshot({ other_active_test_order_count: 1 })).errors.includes("safety:other_active_test_order_exists"), "18 second active order blocked")
  // 19) refund varsa → blocked
  ok(planTestOrderCancel(ALLOWLISTED_ORDER_ID, validSnapshot({ refund_amount: 10 })).errors.includes("safety:refund_exists"), "19 refund blocked")
  // 20) reservation yanlış inventory item → blocked
  ok(planTestOrderCancel(ALLOWLISTED_ORDER_ID, validSnapshot({ reservation_inventory_item_id: "iitem_other" })).errors.includes("safety:reservation_wrong_inventory_item"), "20 reservation wrong inventory blocked")

  // 21) raw SQL yok + hard delete yok
  noSqlGuard()

  // 22) policy version 1
  ok(payload.policy_version === 1, "22 policy version 1")

  console.log(`TEST ORDER CANCEL ISOLATED TESTS: ${passed} PASSED`)
}

try {
  main()
} catch (e) {
  console.error("TEST ORDER CANCEL TEST FAILED:", e instanceof Error ? e.message : e)
  process.exit(1)
}
