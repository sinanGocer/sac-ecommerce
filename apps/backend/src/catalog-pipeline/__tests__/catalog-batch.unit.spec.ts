import {
  buildBaseFingerprintPayload,
  computeBaseFingerprint,
  computePlanFingerprint,
  isConfirmationValid,
  normalizeExternalIds,
} from "../catalog-batch-fingerprint"
import { runGate, runGateResumeTolerant } from "../catalog-batch-gates"
import { withTemporaryEnv } from "../catalog-batch-env"
import { checkReportFreshness, fileChanged } from "../catalog-batch-freshness"
import {
  isStaleLock,
  lockIdentity,
  parseLock,
  parseRecoveryLock,
  serializeLock,
  serializeRecoveryLock,
} from "../catalog-batch-lock"
import {
  InvalidReportError,
  readMetadataStageResult,
  readProjectionStageResult,
  readSyncStageResult,
} from "../catalog-batch-adapters"
import {
  PipelineDeps,
  StageExecution,
  runCatalogPipeline,
} from "../catalog-batch-pipeline"
import { CatalogTotals, PipelineConfig, PipelineStage } from "../catalog-batch-types"

const ctx = { requested: 10, productBefore: 25, productAfter: 35 }
const ids = ["16272", "16706", "62086", "71183", "80717", "16901", "29379", "16789", "17040", "91745"]
const baseFp = computeBaseFingerprint(buildBaseFingerprintPayload(ids, 50))
const planFp = computePlanFingerprint(baseFp, ids, { requested: 10, matched: 10, missing: 0, create: 10, update: 0, review: 0 })

// ── fingerprint ──────────────────────────────────────────────────────────────
describe("fingerprint", () => {
  it("normalize: trim/dedupe/sort", () => {
    expect(normalizeExternalIds("b, a,a,c")).toEqual(["a", "b", "c"])
  })
  it("normalize boş → hata", () => {
    expect(() => normalizeExternalIds("")).toThrow()
  })
  it("base: ID sırası değişince aynı, duplicate aynı", () => {
    const a = computeBaseFingerprint(buildBaseFingerprintPayload(["a", "b"], 50))
    const b = computeBaseFingerprint(buildBaseFingerprintPayload(["b", "a", "a"], 50))
    expect(a).toBe(b)
  })
  it("base: discovery limit değişince farklı", () => {
    expect(computeBaseFingerprint(buildBaseFingerprintPayload(["a"], 50))).not.toBe(
      computeBaseFingerprint(buildBaseFingerprintPayload(["a"], 25))
    )
  })
  it("base: aynı payload her çalışmada aynı (deterministik)", () => {
    expect(computeBaseFingerprint(buildBaseFingerprintPayload(["a"], 50))).toBe(
      computeBaseFingerprint(buildBaseFingerprintPayload(["a"], 50))
    )
  })
  it("plan: dry-run plan sayacı değişince plan_fingerprint farklı", () => {
    const p1 = computePlanFingerprint(baseFp, ids, { requested: 10, matched: 10, missing: 0, create: 10, update: 0, review: 0 })
    const p2 = computePlanFingerprint(baseFp, ids, { requested: 10, matched: 10, missing: 0, create: 9, update: 0, review: 1 })
    expect(p1).not.toBe(p2)
  })
  it("confirmation plan_fingerprint ile birebir", () => {
    expect(isConfirmationValid(planFp, planFp)).toBe(true)
    expect(isConfirmationValid("x", planFp)).toBe(false)
    expect(isConfirmationValid(null, planFp)).toBe(false)
  })
})

// ── gates ───────────────────────────────────────────────────────────────────
describe("gates", () => {
  it("SYNC_COMMIT temiz geçer / db eksik fail", () => {
    expect(runGate("SYNC_COMMIT", ctx, { workflow_calls: 1, committed: 10, db_writes: 10, failed: 0 }).ok).toBe(true)
    expect(runGate("SYNC_COMMIT", ctx, { workflow_calls: 1, committed: 10, db_writes: 9, failed: 0 }).ok).toBe(false)
  })
  it("PROJECTION_IDEMPOTENCY unchanged=productAfter geçer", () => {
    expect(runGate("PROJECTION_IDEMPOTENCY", ctx, { created: 0, updated: 0, unchanged: 35, failed: 0, db_writes: 0 }).ok).toBe(true)
  })
  it("resume-tolerant SYNC_COMMIT no-op geçer", () => {
    expect(runGateResumeTolerant("SYNC_COMMIT", ctx, { workflow_calls: 0, committed: 0, db_writes: 0, failed: 0 }).ok).toBe(true)
  })
})

// ── adapters (fail-closed) ────────────────────────────────────────────────────
describe("report adapters", () => {
  const syncOk = {
    report_schema_version: 1,
    finishedAt: "T",
    dryRun: true,
    summary: {
      requested_external_ids: 10, matched_external_ids: 10, missing_requested_external_ids: [],
      selected: 10, create: 10, update: 0, review: 0, skipped_existing_create_only: 0,
      create_ready: 10, batch_size: 10, workflow_calls: 0, committed: 0, db_writes: 0, failed: 0,
    },
  }
  it("geçerli sync raporu → counters", () => {
    const r = readSyncStageResult(syncOk, { requested: 10, dryRun: true })
    expect(r.counters.create).toBe(10)
  })
  it("eksik alan → InvalidReportError", () => {
    const bad = { ...syncOk, summary: { ...syncOk.summary } } as Record<string, unknown>
    delete (bad.summary as Record<string, unknown>).create
    expect(() => readSyncStageResult(bad, { requested: 10, dryRun: true })).toThrow(InvalidReportError)
  })
  it("string sayı sessizce kabul edilmez", () => {
    const bad = { ...syncOk, summary: { ...syncOk.summary, db_writes: "0" } }
    expect(() => readSyncStageResult(bad, { requested: 10, dryRun: true })).toThrow(/not_number/)
  })
  it("negatif sayaç reddedilir", () => {
    const bad = { ...syncOk, summary: { ...syncOk.summary, failed: -1 } }
    expect(() => readSyncStageResult(bad, { requested: 10, dryRun: true })).toThrow(/negative/)
  })
  it("NaN/Infinity reddedilir", () => {
    const bad = { ...syncOk, summary: { ...syncOk.summary, create: Infinity } }
    expect(() => readSyncStageResult(bad, { requested: 10, dryRun: true })).toThrow(/nan_or_infinity/)
  })
  it("yanlış scope (requested) reddedilir", () => {
    expect(() => readSyncStageResult(syncOk, { requested: 9, dryRun: true })).toThrow(/scope_requested_mismatch/)
  })
  it("yanlış mode reddedilir", () => {
    expect(() => readSyncStageResult(syncOk, { requested: 10, dryRun: false })).toThrow(/mode_mismatch/)
  })
  it("metadata dry geçerli", () => {
    const r = readMetadataStageResult(
      { report_schema_version: 1, mode: "dry-run", scope: { matched_external_ids: 10, missing_external_ids: [] }, totals: { processed: 10, ready_for_v2: 10, needs_review: 0, rejected: 0, identity_conflicts: 0, taxonomy_errors: 0, parser_errors: 0, db_writes: 0 } },
      { mode: "dry-run", requested: 10 }
    )
    expect(r.counters.ready_for_v2).toBe(10)
  })
  it("projection processed < created+updated+unchanged → fail", () => {
    expect(() =>
      readProjectionStageResult(
        { mode: "commit", totals: { processed: 5, created: 10, updated: 0, unchanged: 0, failed: 0, db_writes: 10 } },
        { mode: "commit" }
      )
    ).toThrow(/processed_lt_sum/)
  })
})

// ── env / freshness / lock ────────────────────────────────────────────────────
describe("withTemporaryEnv", () => {
  it("başarı sonrası restore + undefined silinir", async () => {
    const env: NodeJS.ProcessEnv = { A: "orig" }
    await withTemporaryEnv(env, { A: "t", B: "n" }, async () => {})
    expect(env.A).toBe("orig")
    expect(env.B).toBeUndefined()
  })
  it("exception sonrası restore", async () => {
    const env: NodeJS.ProcessEnv = { A: "orig" }
    await expect(withTemporaryEnv(env, { A: "t" }, async () => { throw new Error("boom") })).rejects.toThrow()
    expect(env.A).toBe("orig")
  })
  it("null değer siler, sonra geri yükler", async () => {
    const env: NodeJS.ProcessEnv = { X: "1" }
    await withTemporaryEnv(env, { X: null }, async () => { expect(env.X).toBeUndefined() })
    expect(env.X).toBe("1")
  })
})

describe("freshness", () => {
  const start = Date.parse("2026-06-25T18:00:00.000Z")
  it("fileChanged: mtime ilerledi → true, aynı → false", () => {
    expect(fileChanged({ exists: true, mtimeMs: 1, size: 10 }, { exists: true, mtimeMs: 2, size: 10 })).toBe(true)
    expect(fileChanged({ exists: true, mtimeMs: 2, size: 10 }, { exists: true, mtimeMs: 2, size: 10 })).toBe(false)
  })
  it("checkReportFreshness: stale timestamp reddi", () => {
    expect(checkReportFreshness({ finishedAt: "2026-06-25T17:50:00.000Z" }, { stageStartedAtMs: start, timestampFields: ["finishedAt"], expect: [] }).reason).toBe("stale_report")
  })
  it("no_report", () => {
    expect(checkReportFreshness(null, { stageStartedAtMs: start, timestampFields: ["x"], expect: [] }).reason).toBe("no_report")
  })
})

describe("lock", () => {
  const data = { run_id: "r1", pid: 999, started_at: "2026-06-25T18:00:00.000Z", fingerprint: "abc" }
  it("serialize/parse round-trip valid", () => {
    const p = parseLock(serializeLock(data))
    expect(p.kind).toBe("valid")
  })
  it("bozuk json → invalid (silinmez)", () => {
    expect(parseLock("{bozuk").kind).toBe("invalid")
  })
  it("canlı PID + TTL aşılmış → stale DEĞİL", () => {
    expect(isStaleLock(data, Date.parse("2026-06-25T20:00:00.000Z"), 3600000, "alive")).toBe(false)
  })
  it("ölü PID + TTL aşılmamış → stale değil", () => {
    expect(isStaleLock(data, Date.parse("2026-06-25T18:00:30.000Z"), 3600000, "dead")).toBe(false)
  })
  it("ölü PID + TTL aşılmış → stale", () => {
    expect(isStaleLock(data, Date.parse("2026-06-25T20:00:00.000Z"), 3600000, "dead")).toBe(true)
  })
  it("PID belirsiz → stale değil (fail-closed)", () => {
    expect(isStaleLock(data, Date.parse("2026-06-25T20:00:00.000Z"), 3600000, "unknown")).toBe(false)
  })
  it("lock identity tüm sahiplik alanlarını içerir", () => {
    expect(lockIdentity(data)).toBe("r1:999:2026-06-25T18:00:00.000Z:abc")
  })
  it("recovery mutex typed parse edilir", () => {
    const recovery = { ...data, target_lock_identity: lockIdentity(data) }
    expect(parseRecoveryLock(serializeRecoveryLock(recovery))).toEqual({
      kind: "valid",
      data: recovery,
    })
  })
})

// ── pipeline engine ──────────────────────────────────────────────────────────
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
const deps = (runStage: PipelineDeps["runStage"]): PipelineDeps => ({ runStage, readTotals: async () => totals, now: () => "T", makeRunId: () => "run1" })

describe("runCatalogPipeline", () => {
  it("dry-run: DISCOVERY executed, 8 planned, PIPELINE_DRY_RUN_READY, commit komutu plan_fp içerir", async () => {
    const calls: PipelineStage[] = []
    const r = await runCatalogPipeline(
      { externalIds: ids, discoveryLimit: 50, mode: "dry-run", confirmToken: null, resume: false },
      deps(async (s) => { calls.push(s); return happy(s) })
    )
    expect(calls).toEqual(["DISCOVERY_DRY_RUN"])
    expect(r.final_decision).toBe("PIPELINE_DRY_RUN_READY")
    expect(r.executed_stages).toEqual(["DISCOVERY_DRY_RUN"])
    expect(r.planned_stages.length).toBe(8)
    expect(r.total_db_writes).toBe(0)
    expect(r.plan_fingerprint).toBe(planFp)
    expect(r.commit_command).toContain(planFp)
  })
  it("commit yanlış confirm → PIPELINE_STALE_PLAN (DISCOVERY sonrası, yazım yok)", async () => {
    const calls: PipelineStage[] = []
    const r = await runCatalogPipeline(
      { externalIds: ids, discoveryLimit: 50, mode: "commit", confirmToken: "yanlis", resume: false },
      deps(async (s) => { calls.push(s); return happy(s) })
    )
    expect(r.final_decision).toBe("PIPELINE_STALE_PLAN")
    expect(calls).toEqual(["DISCOVERY_DRY_RUN"]) // yazım aşamaları çalışmadı
    expect(r.total_db_writes).toBe(0)
  })
  it("commit doğru confirm → COMPLETED, 9 aşama, db_writes_by_stage", async () => {
    const r = await runCatalogPipeline(
      { externalIds: ids, discoveryLimit: 50, mode: "commit", confirmToken: planFp, resume: false },
      deps(async (s) => happy(s))
    )
    expect(r.final_decision).toBe("PIPELINE_COMPLETED_AND_IDEMPOTENT")
    expect(r.executed_stages.length).toBe(9)
    expect(r.db_writes_by_stage).toEqual({ sync_commit: 10, metadata_commit: 10, projection_commit: 10, dry_run_and_idempotency: 0 })
    expect(r.total_db_writes).toBe(30)
  })
  it("gate fail → PIPELINE_STOPPED_BY_GATE, sonraki yazım yok", async () => {
    const calls: PipelineStage[] = []
    const r = await runCatalogPipeline(
      { externalIds: ids, discoveryLimit: 50, mode: "commit", confirmToken: planFp, resume: false },
      deps(async (s) => { calls.push(s); return s === "METADATA_COMMIT" ? { counters: { eligible: 10, updated: 9, unchanged: 1, stale_plan: 0, failed: 0, db_writes: 9 }, db_writes: 9, report_path: null } : happy(s) })
    )
    expect(r.final_decision).toBe("PIPELINE_STOPPED_BY_GATE")
    expect(r.failure_stage).toBe("METADATA_COMMIT")
    expect(calls).not.toContain("PROJECTION_COMMIT")
  })
  it("STALE_STAGE_REPORT hatası → PIPELINE_STALE_STAGE_REPORT", async () => {
    const r = await runCatalogPipeline(
      { externalIds: ids, discoveryLimit: 50, mode: "commit", confirmToken: planFp, resume: false },
      deps(async (s) => { if (s === "DISCOVERY_DRY_RUN") throw new Error("STALE_STAGE_REPORT: x"); return happy(s) })
    )
    expect(r.final_decision).toBe("PIPELINE_STALE_STAGE_REPORT")
  })
  it("PIPELINE_INVALID_REPORT hatası → PIPELINE_INVALID_REPORT", async () => {
    const r = await runCatalogPipeline(
      { externalIds: ids, discoveryLimit: 50, mode: "commit", confirmToken: planFp, resume: false },
      deps(async (s) => { if (s === "SYNC_COMMIT") throw new Error("PIPELINE_INVALID_REPORT: negative:db_writes"); return happy(s) })
    )
    expect(r.final_decision).toBe("PIPELINE_INVALID_REPORT")
    expect(r.failure_stage).toBe("SYNC_COMMIT")
  })
  it("resume: commit aşamaları no-op → COMPLETED, db_writes 0, resumed_no_op", async () => {
    const r = await runCatalogPipeline(
      { externalIds: ids, discoveryLimit: 50, mode: "commit", confirmToken: planFp, resume: true },
      deps(async (s) => {
        if (s === "SYNC_COMMIT") return { counters: { workflow_calls: 0, committed: 0, db_writes: 0, failed: 0 }, db_writes: 0, report_path: null }
        if (s === "METADATA_COMMIT") return { counters: { eligible: 10, updated: 0, unchanged: 10, stale_plan: 0, failed: 0, db_writes: 0 }, db_writes: 0, report_path: null }
        if (s === "PROJECTION_COMMIT") return { counters: { created: 0, updated: 0, unchanged: 35, failed: 0, db_writes: 0 }, db_writes: 0, report_path: null }
        return happy(s)
      })
    )
    expect(r.final_decision).toBe("PIPELINE_COMPLETED_AND_IDEMPOTENT")
    expect(r.total_db_writes).toBe(0)
    expect(r.stages.find((x) => x.stage === "SYNC_COMMIT")?.status).toBe("resumed_no_op")
  })
})
