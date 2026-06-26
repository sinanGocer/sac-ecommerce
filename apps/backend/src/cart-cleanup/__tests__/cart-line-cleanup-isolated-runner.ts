/* eslint-disable no-console */
import assert from "assert"

import {
  computeCartCleanupFingerprint,
  isCartConfirmationValid,
  CartCleanupFingerprintPayload,
} from "../cart-line-cleanup-fingerprint"
import {
  ALLOWLISTED_CART_ID,
  ALLOWLISTED_LINE_ITEM_ID,
  CART_CLEANUP_POLICY_VERSION,
  CartReferenceCounts,
  CartSnapshot,
  EXPECTED_TARGET,
} from "../cart-line-cleanup-policy"
import { buildCartCleanupReport } from "../cart-line-cleanup-report"
import { planCartCleanup } from "../cart-line-cleanup-service"

/**
 * jest'siz izole test runner. Çalıştırma: npm run cart:cleanup:test
 */
let passed = 0
function ok(cond: unknown, label: string): void {
  assert.ok(cond, label)
  passed++
}

function validSnapshot(overrides: Partial<CartSnapshot> = {}): CartSnapshot {
  return {
    cart_id: ALLOWLISTED_CART_ID,
    completed_at: null,
    payment_collection_exists: false,
    payment_collection_status: null,
    payment_captured_amount: 0,
    payment_sessions: 0,
    items: [
      {
        id: ALLOWLISTED_LINE_ITEM_ID,
        product_id: EXPECTED_TARGET.product_id,
        variant_id: EXPECTED_TARGET.variant_id,
        quantity: 1,
        unit_price: 2119,
        title: "KİŞİSEL VERİLERİN KORUNMASI...",
      },
      { id: "cali_other_1", product_id: "prod_a", variant_id: "var_a", quantity: 1, unit_price: 1689, title: "A" },
      { id: "cali_other_2", product_id: "prod_b", variant_id: "var_b", quantity: 1, unit_price: 1759, title: "B" },
    ],
    ...overrides,
  }
}

function validCounts(overrides: Partial<CartReferenceCounts> = {}): CartReferenceCounts {
  return { order_reference_count: 0, total_line_items: 3, other_line_items: 2, ...overrides }
}

function run(
  snapshot: CartSnapshot | null,
  counts: CartReferenceCounts | null,
  cartId = ALLOWLISTED_CART_ID,
  lineId = ALLOWLISTED_LINE_ITEM_ID
) {
  return planCartCleanup({ requestedCartId: cartId, requestedLineItemId: lineId, snapshot, counts })
}

function noSqlGuard(): void {
  const fs = require("fs") as typeof import("fs")
  const path = require("path") as typeof import("path")
  const dir = path.resolve(process.cwd(), "src", "cart-cleanup")
  const sqlPattern = /\b(SELECT|INSERT|UPDATE|DELETE|DROP)\s+.*\b(FROM|INTO|TABLE|WHERE|SET)\b/i
  for (const file of fs.readdirSync(dir).filter((f: string) => f.endsWith(".ts"))) {
    ok(!sqlPattern.test(fs.readFileSync(path.join(dir, file), "utf-8")), `no raw SQL in ${file}`)
  }
  const script = fs.readFileSync(
    path.resolve(process.cwd(), "src", "scripts", "cart-line-cleanup.ts"),
    "utf-8"
  )
  ok(!sqlPattern.test(script), "no raw SQL in cart-line-cleanup.ts")
  ok(/deleteLineItemsWorkflow/.test(script) && /query\.graph/.test(script), "script uses Medusa public layer")
}

function main(): void {
  // 1) Doğru cart+line → DRY_RUN_READY
  const happy = run(validSnapshot(), validCounts())
  ok(
    happy.decision === "CART_CLEANUP_DRY_RUN_READY" &&
      happy.allowlist.requested_count === 1 &&
      happy.allowlist.matched_count === 1 &&
      happy.plan_fingerprint !== null &&
      happy.action?.status === "planned",
    "1 happy plan"
  )

  // 2) Cart bulunamadı → PLAN_BLOCKED
  const notFound = run(null, null)
  ok(
    notFound.decision === "CART_CLEANUP_PLAN_BLOCKED" &&
      notFound.allowlist.reason === "cart_not_found",
    "2 cart not found blocked"
  )

  // 3) Yanlış cart id → PLAN_BLOCKED
  const wrongCart = run(validSnapshot(), validCounts(), "cart_WRONG")
  ok(
    wrongCart.decision === "CART_CLEANUP_PLAN_BLOCKED" &&
      wrongCart.allowlist.reason === "requested_cart_not_allowlisted",
    "3 wrong cart blocked"
  )

  // 4) Yanlış line id → PLAN_BLOCKED
  const wrongLine = run(validSnapshot(), validCounts(), ALLOWLISTED_CART_ID, "cali_WRONG")
  ok(
    wrongLine.decision === "CART_CLEANUP_PLAN_BLOCKED" &&
      wrongLine.allowlist.reason === "requested_line_not_allowlisted",
    "4 wrong line blocked"
  )

  // 5) Hedef satır yok → IDEMPOTENT_NOOP (sadece diğer 2 satır var)
  const absent = run(
    validSnapshot({
      items: [
        { id: "cali_other_1", product_id: "prod_a", variant_id: "var_a", quantity: 1, unit_price: 1689, title: "A" },
        { id: "cali_other_2", product_id: "prod_b", variant_id: "var_b", quantity: 1, unit_price: 1759, title: "B" },
      ],
    }),
    validCounts({ total_line_items: 2, other_line_items: 2 })
  )
  ok(
    absent.decision === "CART_CLEANUP_IDEMPOTENT_NOOP" &&
      absent.action?.status === "no_op" &&
      absent.plan_fingerprint === null,
    "5 target absent → idempotent no-op"
  )

  // 6) Identity mismatch (unit_price) → STALE_PLAN
  const priceMismatch = run(
    validSnapshot({
      items: [
        { id: ALLOWLISTED_LINE_ITEM_ID, product_id: EXPECTED_TARGET.product_id, variant_id: EXPECTED_TARGET.variant_id, quantity: 1, unit_price: 9999, title: "x" },
      ],
    }),
    validCounts({ total_line_items: 1, other_line_items: 0 })
  )
  ok(
    priceMismatch.decision === "CART_CLEANUP_STALE_PLAN" &&
      priceMismatch.errors.includes("identity:unit_price"),
    "6 identity mismatch stale"
  )
  // 6b) variant mismatch → stale
  const variantMismatch = run(
    validSnapshot({
      items: [{ id: ALLOWLISTED_LINE_ITEM_ID, product_id: EXPECTED_TARGET.product_id, variant_id: "var_OTHER", quantity: 1, unit_price: 2119, title: "x" }],
    }),
    validCounts({ total_line_items: 1, other_line_items: 0 })
  )
  ok(variantMismatch.decision === "CART_CLEANUP_STALE_PLAN" && variantMismatch.errors.includes("identity:variant_id"), "6b variant mismatch stale")

  // 7) Cart completed → PLAN_BLOCKED
  const completed = run(validSnapshot({ completed_at: "2026-06-25T00:00:00.000Z" }), validCounts({ order_reference_count: 1 }))
  ok(
    completed.decision === "CART_CLEANUP_PLAN_BLOCKED" &&
      completed.errors.includes("safety:cart_completed"),
    "7 completed cart blocked"
  )

  // 8) Payment captured → PLAN_BLOCKED
  const paid = run(validSnapshot({ payment_collection_exists: true, payment_captured_amount: 2119 }), validCounts())
  ok(
    paid.decision === "CART_CLEANUP_PLAN_BLOCKED" &&
      paid.errors.includes("safety:payment_captured"),
    "8 payment captured blocked"
  )

  // 9) Order reference → PLAN_BLOCKED
  const ordered = run(validSnapshot(), validCounts({ order_reference_count: 1 }))
  ok(
    ordered.decision === "CART_CLEANUP_PLAN_BLOCKED" &&
      ordered.errors.includes("safety:order_reference"),
    "9 order reference blocked"
  )

  // 10) Dry-run action executed=false db_writes=0
  ok(happy.action?.executed === false && happy.action?.db_writes === 0, "10 dry-run no execution")

  // 11) Yanlış confirm token reddedilir
  ok(
    !isCartConfirmationValid("wrong", happy.plan_fingerprint!) &&
      !isCartConfirmationValid(null, happy.plan_fingerprint!) &&
      isCartConfirmationValid(happy.plan_fingerprint!, happy.plan_fingerprint!),
    "11 confirm token check"
  )

  // 12) Aynı payload → aynı fingerprint
  const payload: CartCleanupFingerprintPayload = {
    policy_version: CART_CLEANUP_POLICY_VERSION,
    cart_id: ALLOWLISTED_CART_ID,
    line_item_id: ALLOWLISTED_LINE_ITEM_ID,
    product_id: EXPECTED_TARGET.product_id,
    variant_id: EXPECTED_TARGET.variant_id,
    quantity: 1,
    unit_price: 2119,
    cart_completed: false,
    order_reference_count: 0,
    payment_captured: false,
    other_line_item_ids: ["cali_other_2", "cali_other_1"],
    total_line_items: 3,
  }
  ok(
    computeCartCleanupFingerprint(payload) === computeCartCleanupFingerprint({ ...payload }),
    "12 deterministic fingerprint"
  )

  // 13) Policy version değişirse fingerprint değişir
  ok(
    computeCartCleanupFingerprint(payload) !== computeCartCleanupFingerprint({ ...payload, policy_version: 2 }),
    "13 policy version changes fingerprint"
  )

  // 14) Cart içeriği (diğer satırlar) değişirse fingerprint değişir
  ok(
    computeCartCleanupFingerprint(payload) !==
      computeCartCleanupFingerprint({ ...payload, other_line_item_ids: ["cali_other_1"], total_line_items: 2 }),
    "14 cart content changes fingerprint"
  )

  // 15) Diğer satırlar korunur (action target dışında)
  const preserved = happy.action?.detail.preserved_line_item_ids as string[]
  ok(
    Array.isArray(preserved) &&
      preserved.length === 2 &&
      !preserved.includes(ALLOWLISTED_LINE_ITEM_ID) &&
      happy.action?.detail.expected_remaining_line_items === 2,
    "15 other lines preserved"
  )

  // 16) Report db_writes 0 (dry-run) + commit command
  const report = buildCartCleanupReport({
    runId: "r1",
    startedAt: "2026-06-26T00:00:00.000Z",
    finishedAt: "2026-06-26T00:00:01.000Z",
    mode: "dry-run",
    snapshot: validSnapshot(),
    counts: validCounts(),
    plan: happy,
    commitEnabled: false,
    dbWrites: 0,
    finalDecision: happy.decision,
    action: happy.action,
  })
  ok(
    report.db_writes === 0 &&
      report.commit_enabled === false &&
      report.mode === "dry-run" &&
      report.final_decision === "CART_CLEANUP_DRY_RUN_READY" &&
      report.commit_command !== null &&
      report.commit_command.includes(happy.plan_fingerprint!) &&
      report.preserved_line_item_ids.length === 2,
    "16 report db_writes 0 + commit command + preserved"
  )

  // 17) Raw SQL yok
  noSqlGuard()

  console.log(`CART LINE CLEANUP ISOLATED TESTS: ${passed} PASSED`)
}

try {
  main()
} catch (e) {
  console.error("CART CLEANUP TEST FAILED:", e instanceof Error ? e.message : e)
  process.exit(1)
}
