/* eslint-disable no-console */
import assert from "assert"

import {
  computePartialCartFingerprint,
  isPartialCartConfirmationValid,
  PartialCartFingerprintPayload,
} from "../partial-cart-fingerprint"
import {
  ALLOWLISTED_CART_ID,
  EXPECTED_CART,
  PartialCartSnapshot,
} from "../partial-cart-policy"
import { planPartialCartCleanup } from "../partial-cart-service"

/** jest'siz izole test runner. Çalıştırma: npm run partial-cart:cleanup:test */
let passed = 0
function ok(cond: unknown, label: string): void {
  assert.ok(cond, label)
  passed++
}

function validSnapshot(over: Partial<PartialCartSnapshot> = {}): PartialCartSnapshot {
  return {
    cart_id: ALLOWLISTED_CART_ID,
    found: true,
    deleted_at: null,
    completed_at: null,
    email: EXPECTED_CART.email,
    item_count: 1,
    line: { variant_id: EXPECTED_CART.variant_id, quantity: 1, unit_price: 169 },
    shipping_option_id: EXPECTED_CART.shipping_option_id,
    shipping_total: 59,
    total: 228,
    payment_collection_id: "pay_col_1",
    payment_session_id: "payses_1",
    payment_session_status: "pending",
    payment_captured_amount: 0,
    payment_provider_id: "pp_system_default",
    order_reference_count: 0,
    inventory_reservation_count: 0,
    ...over,
  }
}

function statusOf(plan: ReturnType<typeof planPartialCartCleanup>, action: string): string {
  return plan.actions.find((a) => a.action === action)?.status ?? "missing"
}

function noSqlGuard(): void {
  const fs = require("fs") as typeof import("fs")
  const path = require("path") as typeof import("path")
  const dir = path.resolve(process.cwd(), "src", "partial-cart-cleanup")
  const sqlPattern = /\b(SELECT|INSERT|UPDATE|DELETE|DROP)\s+.*\b(FROM|INTO|TABLE|WHERE|SET)\b/i
  for (const file of fs.readdirSync(dir).filter((f: string) => f.endsWith(".ts"))) {
    ok(!sqlPattern.test(fs.readFileSync(path.join(dir, file), "utf-8")), `no raw SQL in ${file}`)
  }
  const script = fs.readFileSync(path.resolve(process.cwd(), "src", "scripts", "partial-cart-cleanup.ts"), "utf-8")
  ok(!sqlPattern.test(script), "no raw SQL in partial-cart-cleanup.ts")
  ok(/softDeleteCarts/.test(script) && !/\.deleteCarts\(/.test(script), "uses soft delete, not hard delete")
}

function main(): void {
  // 1) valid → DRY_RUN_READY, 2 aksiyon planned
  const happy = planPartialCartCleanup(ALLOWLISTED_CART_ID, validSnapshot())
  ok(
    happy.decision === "PARTIAL_CART_CLEANUP_DRY_RUN_READY" &&
      happy.plan_fingerprint !== null &&
      statusOf(happy, "PAYMENT_SESSION_DELETE") === "planned" &&
      statusOf(happy, "CART_SOFT_DELETE") === "planned",
    "1 happy plan"
  )

  // 2) cart not found → blocked
  ok(
    planPartialCartCleanup(ALLOWLISTED_CART_ID, validSnapshot({ found: false })).decision === "PARTIAL_CART_CLEANUP_PLAN_BLOCKED",
    "2 not found blocked"
  )
  // 3) wrong cart id → blocked
  ok(
    planPartialCartCleanup("cart_WRONG", validSnapshot({ cart_id: "cart_WRONG" })).allowlist.reason === "requested_cart_not_allowlisted",
    "3 wrong cart blocked"
  )
  // 4) identity mismatch → stale
  {
    const p = planPartialCartCleanup(ALLOWLISTED_CART_ID, validSnapshot({ total: 999 }))
    ok(p.decision === "PARTIAL_CART_CLEANUP_STALE_PLAN" && p.errors.includes("identity:total"), "4 identity mismatch stale")
  }
  {
    const p = planPartialCartCleanup(ALLOWLISTED_CART_ID, validSnapshot({ email: "real@customer.com" }))
    ok(p.decision === "PARTIAL_CART_CLEANUP_STALE_PLAN" && p.errors.includes("identity:email"), "4b email mismatch stale (real customer protection)")
  }
  // 5) cart completed → blocked
  ok(
    planPartialCartCleanup(ALLOWLISTED_CART_ID, validSnapshot({ completed_at: "2026-06-26" })).errors.includes("safety:cart_completed"),
    "5 completed blocked"
  )
  // 6) order ref → blocked
  ok(
    planPartialCartCleanup(ALLOWLISTED_CART_ID, validSnapshot({ order_reference_count: 1 })).errors.includes("safety:order_reference"),
    "6 order ref blocked"
  )
  // 7) payment captured → blocked
  ok(
    planPartialCartCleanup(ALLOWLISTED_CART_ID, validSnapshot({ payment_captured_amount: 228 })).errors.includes("safety:payment_captured"),
    "7 payment captured blocked"
  )
  // 8) inventory reservation → blocked
  ok(
    planPartialCartCleanup(ALLOWLISTED_CART_ID, validSnapshot({ inventory_reservation_count: 1 })).errors.includes("safety:inventory_reserved"),
    "8 inventory reserved blocked"
  )
  // 9) already soft-deleted → idempotent no-op
  {
    const p = planPartialCartCleanup(ALLOWLISTED_CART_ID, validSnapshot({ deleted_at: "2026-06-26" }))
    ok(p.decision === "PARTIAL_CART_CLEANUP_IDEMPOTENT_NOOP" && statusOf(p, "CART_SOFT_DELETE") === "no_op", "9 already deleted idempotent")
  }
  // 10) dry-run actions executed false db_writes 0
  ok(happy.actions.every((a) => a.executed === false && a.db_writes === 0), "10 dry-run no execution")
  // 11) wrong token rejected
  ok(
    !isPartialCartConfirmationValid("x", happy.plan_fingerprint!) &&
      isPartialCartConfirmationValid(happy.plan_fingerprint!, happy.plan_fingerprint!),
    "11 confirm token"
  )
  // 12) deterministic fingerprint
  const payload: PartialCartFingerprintPayload = happy.fingerprint_payload!
  ok(computePartialCartFingerprint(payload) === computePartialCartFingerprint({ ...payload }), "12 deterministic fp")
  // 13) policy version changes fingerprint
  ok(computePartialCartFingerprint(payload) !== computePartialCartFingerprint({ ...payload, policy_version: 2 }), "13 policy version changes fp")
  // 14) soft-delete strategy (not hard delete)
  ok(
    happy.actions.some((a) => a.action === "CART_SOFT_DELETE" && /soft_delete/.test(String(a.detail.strategy))),
    "14 soft delete strategy"
  )
  // 15) payment session yoksa no_op
  ok(
    statusOf(planPartialCartCleanup(ALLOWLISTED_CART_ID, validSnapshot({ payment_session_id: null })), "PAYMENT_SESSION_DELETE") === "no_op",
    "15 no session → no_op"
  )

  // 16) no raw SQL + soft delete
  noSqlGuard()

  console.log(`PARTIAL CART CLEANUP ISOLATED TESTS: ${passed} PASSED`)
}

try {
  main()
} catch (e) {
  console.error("PARTIAL CART TEST FAILED:", e instanceof Error ? e.message : e)
  process.exit(1)
}
