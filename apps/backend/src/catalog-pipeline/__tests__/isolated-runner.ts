/* eslint-disable no-console */
import assert from "assert"

import {
  readMetadataStageResult,
  readProjectionStageResult,
  readSyncStageResult,
} from "../catalog-batch-adapters"
import { withTemporaryEnv } from "../catalog-batch-env"
import {
  buildBaseFingerprintPayload,
  computeBaseFingerprint,
  computePlanFingerprint,
  isConfirmationValid,
  normalizeExternalIds,
} from "../catalog-batch-fingerprint"
import { checkReportFreshness, fileChanged } from "../catalog-batch-freshness"
import { runGate, runGateResumeTolerant } from "../catalog-batch-gates"
import { isStaleLock, parseLock, serializeLock } from "../catalog-batch-lock"
import {
  PipelineDeps,
  StageExecution,
  runCatalogPipeline,
} from "../catalog-batch-pipeline"
import { CatalogTotals, PipelineStage } from "../catalog-batch-types"

/**
 * jest'siz izole test runner (ts-node ile). Repo jest.config'i kırık olsa ve
 * @swc native binding farklı platformda olsa bile catalog-pipeline çekirdeğini
 * doğrular. Çalıştırma: npm run catalog:test
 */
let passed = 0
function ok(cond: unknown, label: string): void {
  assert.ok(cond, label)
  passed++
}

const ids = ["16272", "16706", "62086", "71183", "80717", "16901", "29379", "16789", "17040", "91745"]
const ctx = { requested: 10, productBefore: 25, productAfter: 35 }
const base = computeBaseFingerprint(buildBaseFingerprintPayload(ids, 50))
const plan = computePlanFingerprint(base, ids, { requested: 10, matched: 10, missing: 0, create: 10, update: 0, review: 0 })

const totals: CatalogTotals = { product: 25, aveda: 20, aveda_metadata_v2: 20, salon_seed_v1: 5, projection_rows: 25 }
function happy(stage: PipelineStage): StageExecution {
  const r = 10
  const m: Record<string, StageExecution["counters"]> = {
    DISCOVERY_DRY_RUN: { requested_external_ids: r, matched_external_ids: r, missing: 0, selected: r, create: r, update: 0, review: 0, create_ready: r, batch_size: r, workflow_calls: 0, db_writes: 0 },
    SYNC_COMMIT: { workflow_calls: 1, committed: r, db_writes: r, failed: 0 },
    SYNC_IDEMPOTENCY: { skipped_existing_create_only: r, create: 0, workflow_calls: 0, committed: 0, db_writes: 0 },
    METADATA_DRY_RUN: { matched_external_ids: r, missing: 0, processed: r, ready_for_v2: r, needs_review: 0, rejected: 0, identity_conflicts: 0, taxonomy_errors: 0, parser_errors: 0, db_writes: 0 },
    METADATA_COMMIT: { eligible: r, updated: r, unchanged: 0, stale_plan: 0, failed: 0, db_writes: r },
    METADATA_IDEMPOTENCY: { updated: 0, unchanged: r, stale_plan: 0, failed: 0, db_writes: 0 },
    PROJECTION_DRY_RUN: { processed: 35, created: r, updated: 0, failed: 0, db_writes: 0 },
    PROJECTION_COMMIT: { created: r, updated: 0, failed: 0, db_writes: r },
    PROJECTION_IDEMPOTENCY: { created: 0, updated: 0, unchanged: 35, failed: 0, db_writes: 0 },
  }
  return { counters: m[stage] ?? {}, db_writes: (m[stage] ?? {}).db_writes ?? 0, report_path: null }
}
const deps = (runStage: PipelineDeps["runStage"]): PipelineDeps => ({ runStage, readTotals: async () => totals, now: () => "T", makeRunId: () => "r1" })

async function main(): Promise<void> {
  // fingerprint
  assert.deepStrictEqual(normalizeExternalIds("b, a,a"), ["a", "b"]); passed++
  ok(computeBaseFingerprint(buildBaseFingerprintPayload(["a", "b"], 50)) === computeBaseFingerprint(buildBaseFingerprintPayload(["b", "a", "a"], 50)), "base order/dedupe")
  ok(computeBaseFingerprint(buildBaseFingerprintPayload(["a"], 50)) !== computeBaseFingerprint(buildBaseFingerprintPayload(["a"], 25)), "limit diff")
  ok(plan !== computePlanFingerprint(base, ids, { requested: 10, matched: 10, missing: 0, create: 9, update: 0, review: 1 }), "plan counter diff")
  ok(isConfirmationValid(plan, plan) && !isConfirmationValid("x", plan), "confirm plan")

  // gates
  ok(runGate("SYNC_COMMIT", ctx, { workflow_calls: 1, committed: 10, db_writes: 10, failed: 0 }).ok, "sync gate ok")
  ok(!runGate("SYNC_COMMIT", ctx, { workflow_calls: 1, committed: 10, db_writes: 9, failed: 0 }).ok, "sync gate fail")
  ok(runGateResumeTolerant("SYNC_COMMIT", ctx, { workflow_calls: 0, committed: 0, db_writes: 0, failed: 0 }).ok, "resume noop")

  // env
  const env: NodeJS.ProcessEnv = { A: "orig" }
  await withTemporaryEnv(env, { A: "t", B: "n" }, async () => { ok(env.A === "t" && env.B === "n", "env applied") })
  ok(env.A === "orig" && env.B === undefined, "env restored")
  let threw = false
  try { await withTemporaryEnv(env, { A: "t" }, async () => { throw new Error("x") }) } catch { threw = true }
  ok(threw && env.A === "orig", "env finally restore")

  // freshness
  const start = Date.parse("2026-06-25T18:00:00.000Z")
  ok(fileChanged({ exists: true, mtimeMs: 1, size: 10 }, { exists: true, mtimeMs: 2, size: 10 }), "file changed")
  ok(!fileChanged({ exists: true, mtimeMs: 2, size: 10 }, { exists: true, mtimeMs: 2, size: 10 }), "file unchanged")
  ok(checkReportFreshness({ finishedAt: "2026-06-25T17:50:00.000Z" }, { stageStartedAtMs: start, timestampFields: ["finishedAt"], expect: [] }).reason === "stale_report", "stale ts")

  // lock
  const ld = { run_id: "r", pid: 9, started_at: "2026-06-25T18:00:00.000Z", fingerprint: "f" }
  ok(parseLock("{x").kind === "invalid", "lock invalid")
  ok(parseLock(serializeLock(ld)).kind === "valid", "lock valid")
  ok(!isStaleLock(ld, Date.parse("2026-06-25T20:00:00.000Z"), 3600000, "alive"), "alive never stale")
  ok(!isStaleLock(ld, Date.parse("2026-06-25T20:00:00.000Z"), 3600000, "unknown"), "unknown not stale")
  ok(isStaleLock(ld, Date.parse("2026-06-25T20:00:00.000Z"), 3600000, "dead"), "dead+ttl stale")
  ok(!isStaleLock(ld, Date.parse("2026-06-25T18:00:30.000Z"), 3600000, "dead"), "dead+fresh not stale")

  // adapters
  threw = false
  try { readSyncStageResult({ finishedAt: "T", dryRun: true, summary: { requested_external_ids: 10, matched_external_ids: 10, missing_requested_external_ids: [], selected: 10, create: 10, update: 0, review: 0, skipped_existing_create_only: 0, create_ready: 10, batch_size: 10, workflow_calls: 0, committed: 0, db_writes: "0", failed: 0 } }, { requested: 10, dryRun: true }) } catch (e) { threw = /not_number/.test((e as Error).message) }
  ok(threw, "adapter rejects string-number")
  threw = false
  try { readProjectionStageResult({ mode: "commit", totals: { processed: 5, created: 10, updated: 0, unchanged: 0, failed: 0, db_writes: 10 } }, { mode: "commit" }) } catch (e) { threw = /processed_lt_sum/.test((e as Error).message) }
  ok(threw, "adapter invariant")
  ok(readMetadataStageResult({ report_schema_version: 1, mode: "dry-run", scope: { matched_external_ids: 10, missing_external_ids: [] }, totals: { processed: 10, ready_for_v2: 10, needs_review: 0, rejected: 0, identity_conflicts: 0, taxonomy_errors: 0, parser_errors: 0, db_writes: 0 } }, { mode: "dry-run", requested: 10 }).counters.ready_for_v2 === 10, "metadata dry ok")

  // pipeline
  let calls: PipelineStage[] = []
  let r = await runCatalogPipeline({ externalIds: ids, discoveryLimit: 50, mode: "dry-run", confirmToken: null, resume: false }, deps(async (s) => { calls.push(s); return happy(s) }))
  ok(r.final_decision === "PIPELINE_DRY_RUN_READY" && calls.length === 1 && r.planned_stages.length === 8 && r.plan_fingerprint === plan && (r.commit_command ?? "").includes(plan) && r.total_db_writes === 0, "dry ready")
  r = await runCatalogPipeline({ externalIds: ids, discoveryLimit: 50, mode: "commit", confirmToken: "x", resume: false }, deps(async (s) => happy(s)))
  ok(r.final_decision === "PIPELINE_STALE_PLAN" && r.total_db_writes === 0, "stale plan")
  r = await runCatalogPipeline({ externalIds: ids, discoveryLimit: 50, mode: "commit", confirmToken: plan, resume: false }, deps(async (s) => happy(s)))
  ok(r.final_decision === "PIPELINE_COMPLETED_AND_IDEMPOTENT" && r.total_db_writes === 30 && r.db_writes_by_stage.dry_run_and_idempotency === 0, "completed 30")
  calls = []
  r = await runCatalogPipeline({ externalIds: ids, discoveryLimit: 50, mode: "commit", confirmToken: plan, resume: false }, deps(async (s) => { calls.push(s); return s === "METADATA_COMMIT" ? { counters: { eligible: 10, updated: 9, unchanged: 1, stale_plan: 0, failed: 0, db_writes: 9 }, db_writes: 9, report_path: null } : happy(s) }))
  ok(r.final_decision === "PIPELINE_STOPPED_BY_GATE" && r.failure_stage === "METADATA_COMMIT" && !calls.includes("PROJECTION_COMMIT"), "gate stop")
  r = await runCatalogPipeline({ externalIds: ids, discoveryLimit: 50, mode: "commit", confirmToken: plan, resume: false }, deps(async (s) => { if (s === "DISCOVERY_DRY_RUN") throw new Error("STALE_STAGE_REPORT: x"); return happy(s) }))
  ok(r.final_decision === "PIPELINE_STALE_STAGE_REPORT", "stale stage")
  r = await runCatalogPipeline({ externalIds: ids, discoveryLimit: 50, mode: "commit", confirmToken: plan, resume: false }, deps(async (s) => { if (s === "SYNC_COMMIT") throw new Error("PIPELINE_INVALID_REPORT: x"); return happy(s) }))
  ok(r.final_decision === "PIPELINE_INVALID_REPORT", "invalid report")

  console.log(`CATALOG PIPELINE ISOLATED TESTS: ${passed} PASSED`)
}

main().catch((e) => {
  console.error("ISOLATED TEST FAILED:", e instanceof Error ? e.message : e)
  process.exit(1)
})
