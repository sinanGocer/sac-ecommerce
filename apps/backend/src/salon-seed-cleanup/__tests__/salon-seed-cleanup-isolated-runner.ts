/* eslint-disable no-console */
import assert from "assert"

import {
  ALLOWLISTED_SEED_PRODUCTS,
  ProductReferenceCounts,
  SeedProductSnapshot,
} from "../salon-seed-cleanup-policy"
import { buildSalonSeedCleanupReport } from "../salon-seed-cleanup-report"
import { planSalonSeedCleanup } from "../salon-seed-cleanup-service"

let passed = 0
function ok(cond: unknown, label: string): void {
  assert.ok(cond, label)
  passed++
}

function snapshot(
  product: (typeof ALLOWLISTED_SEED_PRODUCTS)[number],
  overrides: Partial<SeedProductSnapshot> = {}
): SeedProductSnapshot {
  return {
    product_id: product.product_id,
    title: product.title,
    handle: product.handle,
    status: "published",
    metadata: {},
    variant_skus: [`${product.handle}-1`.toUpperCase()],
    sales_channels: [{ id: "sc_default", name: "Default Sales Channel" }],
    projection: { id: `psp_${product.product_id}`, product_id: product.product_id },
    ...overrides,
  }
}

function counts(overrides: Partial<ProductReferenceCounts> = {}): ProductReferenceCounts {
  return {
    active_cart_lines: 0,
    completed_cart_lines: 0,
    order_lines: 0,
    order_items: 0,
    blocking_order_lines: 0,
    safe_test_order_lines: 0,
    variant_count: 1,
    price_count: 1,
    image_count: 0,
    sales_channel_relations: 1,
    category_relations: 1,
    projection_count: 1,
    ...overrides,
  }
}

function validInput(overrides: {
  snapshots?: SeedProductSnapshot[]
  countsByProductId?: Record<string, ProductReferenceCounts>
} = {}) {
  const snapshots =
    overrides.snapshots ?? ALLOWLISTED_SEED_PRODUCTS.map((p) => snapshot(p))
  const countsByProductId =
    overrides.countsByProductId ??
    Object.fromEntries(snapshots.map((s) => [s.product_id, counts()]))
  return { snapshots, countsByProductId }
}

function main(): void {
  const ready = planSalonSeedCleanup(validInput())
  ok(ready.decision === "SALON_SEED_CLEANUP_DRY_RUN_READY", "ready decision")
  ok(ready.matched_product_ids.length === 5, "matches five products")
  ok(ready.planned_actions.length === 15, "three actions per product")
  ok(
    ready.planned_actions.every((a) => a.executed === false && a.db_writes === 0),
    "dry-run actions do not write"
  )
  ok(ready.plan_fingerprint !== null, "fingerprint exists")
  ok(
    ready.planned_actions.filter((a) => a.action === "PRODUCT_UNPUBLISH").length === 5,
    "unpublish planned"
  )
  ok(
    ready.planned_actions.filter((a) => a.action === "SALES_CHANNEL_DETACH").length === 5,
    "channel detach planned"
  )
  ok(
    ready.planned_actions.filter((a) => a.action === "PROJECTION_REMOVE_OR_HIDE").length === 5,
    "projection remove/hide planned"
  )

  const missing = planSalonSeedCleanup(
    validInput({ snapshots: ALLOWLISTED_SEED_PRODUCTS.slice(0, 4).map((p) => snapshot(p)) })
  )
  ok(missing.decision === "SALON_SEED_CLEANUP_SCOPE_MISMATCH", "missing product blocks")
  ok(missing.missing_product_ids.length === 1, "missing product reported")

  const wrongHandle = planSalonSeedCleanup(
    validInput({
      snapshots: ALLOWLISTED_SEED_PRODUCTS.map((p, i) =>
        snapshot(p, i === 0 ? { handle: "changed" } : {})
      ),
    })
  )
  ok(wrongHandle.decision === "SALON_SEED_CLEANUP_SCOPE_MISMATCH", "identity mismatch blocks")
  ok(wrongHandle.errors.some((e) => e.includes("handle")), "identity error reported")

  const cartBlockedSnapshots = ALLOWLISTED_SEED_PRODUCTS.map((p) => snapshot(p))
  const cartBlockedCounts = Object.fromEntries(
    cartBlockedSnapshots.map((s, i) => [
      s.product_id,
      counts(i === 0 ? { active_cart_lines: 1 } : {}),
    ])
  )
  const cartBlocked = planSalonSeedCleanup({
    snapshots: cartBlockedSnapshots,
    countsByProductId: cartBlockedCounts,
  })
  ok(cartBlocked.decision === "SALON_SEED_CLEANUP_BLOCKED", "cart reference blocks")
  ok(cartBlocked.blocked_product_ids.length === 1, "blocked product reported")
  ok(
    cartBlocked.planned_actions
      .filter((a) => a.product_id === cartBlocked.blocked_product_ids[0])
      .every((a) => a.status === "blocked"),
    "referenced product actions blocked"
  )

  // Active / non-test / captured-fulfilled order → blocking_order_lines blocks.
  const orderBlockedCounts = Object.fromEntries(
    cartBlockedSnapshots.map((s, i) => [
      s.product_id,
      counts(i === 1 ? { order_lines: 1, order_items: 2, blocking_order_lines: 1 } : {}),
    ])
  )
  const orderBlocked = planSalonSeedCleanup({
    snapshots: cartBlockedSnapshots,
    countsByProductId: orderBlockedCounts,
  })
  ok(orderBlocked.decision === "SALON_SEED_CLEANUP_BLOCKED", "blocking order reference blocks")
  ok(orderBlocked.blockers[0].blockers.includes("blocking_order"), "blocking order reported")

  // Policy v2: canceled + uncaptured + unfulfilled TEST order → engellemez.
  const safeTestCounts = Object.fromEntries(
    cartBlockedSnapshots.map((s, i) => [
      s.product_id,
      counts(i === 1 ? { order_lines: 1, order_items: 1, safe_test_order_lines: 1 } : {}),
    ])
  )
  const safeTestOrder = planSalonSeedCleanup({
    snapshots: cartBlockedSnapshots,
    countsByProductId: safeTestCounts,
  })
  ok(
    safeTestOrder.decision === "SALON_SEED_CLEANUP_DRY_RUN_READY",
    "canceled test order does not block"
  )
  ok(safeTestOrder.planned_actions.length === 15, "safe test order keeps 15 actions")
  ok(safeTestOrder.blocked_product_ids.length === 0, "safe test order no blocked products")

  // Policy v2: historical completed cart (completed_at!=null) → engellemez.
  const historicalCartCounts = Object.fromEntries(
    cartBlockedSnapshots.map((s, i) => [
      s.product_id,
      counts(i === 1 ? { completed_cart_lines: 1 } : {}),
    ])
  )
  const historicalCart = planSalonSeedCleanup({
    snapshots: cartBlockedSnapshots,
    countsByProductId: historicalCartCounts,
  })
  ok(
    historicalCart.decision === "SALON_SEED_CLEANUP_DRY_RUN_READY",
    "historical completed cart does not block"
  )

  // Live isi-koruyucu senaryosu: historical completed cart + canceled test order
  // birlikte → READY, 15 planned action.
  const isiCounts = Object.fromEntries(
    cartBlockedSnapshots.map((s, i) => [
      s.product_id,
      counts(
        i === 1
          ? { completed_cart_lines: 1, order_lines: 1, order_items: 1, safe_test_order_lines: 1 }
          : {}
      ),
    ])
  )
  const isiScenario = planSalonSeedCleanup({
    snapshots: cartBlockedSnapshots,
    countsByProductId: isiCounts,
  })
  ok(
    isiScenario.decision === "SALON_SEED_CLEANUP_DRY_RUN_READY",
    "isi live scenario ready"
  )
  ok(isiScenario.planned_actions.length === 15, "isi scenario 15 planned actions")
  ok(
    isiScenario.planned_actions.every((a) => a.status === "planned"),
    "isi scenario all planned"
  )

  const noOps = planSalonSeedCleanup(
    validInput({
      snapshots: ALLOWLISTED_SEED_PRODUCTS.map((p) =>
        snapshot(p, {
          status: "draft",
          sales_channels: [],
          projection: null,
        })
      ),
    })
  )
  ok(noOps.decision === "SALON_SEED_CLEANUP_DRY_RUN_READY", "already cleaned is ready")
  ok(noOps.planned_actions.every((a) => a.status === "no_op"), "already cleaned no-op")

  const report = buildSalonSeedCleanupReport({
    runId: "run",
    startedAt: "start",
    finishedAt: "finish",
    snapshots: validInput().snapshots,
    countsByProductId: validInput().countsByProductId,
    plan: ready,
  })
  ok(report.db_writes === 0, "report db writes zero")
  ok(report.final_decision === "SALON_SEED_CLEANUP_DRY_RUN_READY", "report decision")

  console.log(`[salon-seed-cleanup:test] ${passed} assertions passed`)
}

main()
