/* eslint-disable no-console */
import assert from "assert"

import { isSalonSeedCommitConfirmationValid } from "../salon-seed-cleanup-fingerprint"
import {
  ALLOWLISTED_SEED_PRODUCTS,
  ProductReferenceCounts,
  SeedProductSnapshot,
} from "../salon-seed-cleanup-policy"
import { buildSalonSeedCleanupReport } from "../salon-seed-cleanup-report"
import { planSalonSeedCleanup } from "../salon-seed-cleanup-service"
import {
  executeSalonSeedCleanup,
  SeedCleanupMutator,
} from "../salon-seed-cleanup-writer"

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

function readyPlanInput(snapshots: SeedProductSnapshot[]) {
  return {
    snapshots,
    countsByProductId: Object.fromEntries(snapshots.map((s) => [s.product_id, counts()])),
  }
}

interface RecordingMutator extends SeedCleanupMutator {
  unpublishCalls: string[]
  detachCalls: Array<{ productId: string; channelIds: string[] }>
  projectionCalls: string[]
}

function recordingMutator(): RecordingMutator {
  const m: RecordingMutator = {
    unpublishCalls: [],
    detachCalls: [],
    projectionCalls: [],
    async unpublishProduct(productId) {
      m.unpublishCalls.push(productId)
    },
    async detachSalesChannels(productId, channelIds) {
      m.detachCalls.push({ productId, channelIds })
    },
    async removeProjection(projectionId) {
      m.projectionCalls.push(projectionId)
    },
  }
  return m
}

async function main(): Promise<void> {
  // ── 1) Confirmation guard ────────────────────────────────────────────────
  ok(isSalonSeedCommitConfirmationValid("abc123", "abc123"), "matching token valid")
  ok(!isSalonSeedCommitConfirmationValid("wrong", "abc123"), "wrong token invalid")
  ok(!isSalonSeedCommitConfirmationValid(null, "abc123"), "null token invalid")
  ok(!isSalonSeedCommitConfirmationValid("abc123", null), "null fingerprint invalid")
  ok(!isSalonSeedCommitConfirmationValid("", "abc123"), "empty token invalid")
  ok(isSalonSeedCommitConfirmationValid("  abc123  ", "abc123"), "trimmed token valid")

  // ── 2) Writer happy path → COMMITTED, 15 writes ──────────────────────────
  const readyPlan = planSalonSeedCleanup(
    readyPlanInput(ALLOWLISTED_SEED_PRODUCTS.map((p) => snapshot(p)))
  )
  ok(readyPlan.decision === "SALON_SEED_CLEANUP_DRY_RUN_READY", "plan ready for commit")
  const mut = recordingMutator()
  const committed = await executeSalonSeedCleanup(readyPlan, mut)
  ok(committed.decision === "SALON_SEED_CLEANUP_COMMITTED", "writer committed")
  ok(committed.db_writes === 15, "15 db writes (5×unpublish+detach+projection)")
  ok(committed.projection_writes === 5, "5 projection writes")
  ok(mut.unpublishCalls.length === 5, "5 unpublish calls")
  ok(mut.detachCalls.length === 5 && mut.detachCalls.every((c) => c.channelIds.length === 1), "5 detach calls, 1 channel each")
  ok(mut.projectionCalls.length === 5, "5 projection removals")
  ok(
    committed.executed_actions.filter((a) => a.executed).length === 15,
    "15 executed actions recorded"
  )

  // ── 3) Idempotent re-run → IDEMPOTENT_NOOP, 0 writes ─────────────────────
  const cleanedPlan = planSalonSeedCleanup(
    readyPlanInput(
      ALLOWLISTED_SEED_PRODUCTS.map((p) =>
        snapshot(p, { status: "draft", sales_channels: [], projection: null })
      )
    )
  )
  ok(cleanedPlan.decision === "SALON_SEED_CLEANUP_DRY_RUN_READY", "cleaned plan still ready")
  ok(cleanedPlan.planned_actions.every((a) => a.status === "no_op"), "cleaned plan all no_op")
  const mut2 = recordingMutator()
  const idempotent = await executeSalonSeedCleanup(cleanedPlan, mut2)
  ok(idempotent.decision === "SALON_SEED_CLEANUP_IDEMPOTENT_NOOP", "writer idempotent no-op")
  ok(idempotent.db_writes === 0, "idempotent 0 db writes")
  ok(
    mut2.unpublishCalls.length === 0 && mut2.detachCalls.length === 0 && mut2.projectionCalls.length === 0,
    "no mutator calls on idempotent run"
  )

  // ── 4) Fail-closed: non-READY plan → throws, 0 mutator calls ─────────────
  const blockedSnaps = ALLOWLISTED_SEED_PRODUCTS.map((p) => snapshot(p))
  const blockedPlan = planSalonSeedCleanup({
    snapshots: blockedSnaps,
    countsByProductId: Object.fromEntries(
      blockedSnaps.map((s, i) => [s.product_id, counts(i === 0 ? { active_cart_lines: 1, blocking_order_lines: 0 } : {})])
    ),
  })
  ok(blockedPlan.decision === "SALON_SEED_CLEANUP_BLOCKED", "active cart blocks plan")
  const mut3 = recordingMutator()
  let threw = false
  try {
    await executeSalonSeedCleanup(blockedPlan, mut3)
  } catch {
    threw = true
  }
  ok(threw, "writer refuses non-READY plan")
  ok(
    mut3.unpublishCalls.length === 0 && mut3.detachCalls.length === 0 && mut3.projectionCalls.length === 0,
    "no mutator calls when blocked"
  )

  // ── 5) Scope mismatch plan → throws ──────────────────────────────────────
  const scopePlan = planSalonSeedCleanup(
    readyPlanInput(ALLOWLISTED_SEED_PRODUCTS.slice(0, 4).map((p) => snapshot(p)))
  )
  ok(scopePlan.decision === "SALON_SEED_CLEANUP_SCOPE_MISMATCH", "missing product scope mismatch")
  let threw2 = false
  try {
    await executeSalonSeedCleanup(scopePlan, recordingMutator())
  } catch {
    threw2 = true
  }
  ok(threw2, "writer refuses scope-mismatch plan")

  // ── 6) Commit report shape ───────────────────────────────────────────────
  const report = buildSalonSeedCleanupReport({
    runId: "run",
    startedAt: "start",
    finishedAt: "finish",
    snapshots: ALLOWLISTED_SEED_PRODUCTS.map((p) => snapshot(p)),
    countsByProductId: Object.fromEntries(
      ALLOWLISTED_SEED_PRODUCTS.map((p) => [p.product_id, counts()])
    ),
    plan: readyPlan,
    mode: "commit",
    commitEnabled: true,
    commitConfirmed: true,
    executedActions: committed.executed_actions,
    dbWrites: committed.db_writes,
    projectionWrites: committed.projection_writes,
    finalDecision: committed.decision,
  })
  ok(report.mode === "commit", "report mode commit")
  ok(report.commit_enabled === true && report.commit_confirmed === true, "report commit flags")
  ok(report.db_writes === 15 && report.projection_writes === 5, "report write totals")
  ok(report.final_decision === "SALON_SEED_CLEANUP_COMMITTED", "report committed decision")
  ok(report.executed_actions.length === 15, "report executed actions")

  // ── 7) Default dry-run report stays 0 writes (backward compat) ───────────
  const dryReport = buildSalonSeedCleanupReport({
    runId: "run",
    startedAt: "start",
    finishedAt: "finish",
    snapshots: ALLOWLISTED_SEED_PRODUCTS.map((p) => snapshot(p)),
    countsByProductId: Object.fromEntries(
      ALLOWLISTED_SEED_PRODUCTS.map((p) => [p.product_id, counts()])
    ),
    plan: readyPlan,
  })
  ok(
    dryReport.mode === "dry-run" && dryReport.db_writes === 0 && dryReport.commit_enabled === false,
    "default report is dry-run 0 writes"
  )

  console.log(`[salon-seed-cleanup:commit:test] ${passed} assertions passed`)
}

main().catch((e) => {
  console.error("COMMIT TEST FAILED:", e instanceof Error ? e.message : e)
  process.exit(1)
})
