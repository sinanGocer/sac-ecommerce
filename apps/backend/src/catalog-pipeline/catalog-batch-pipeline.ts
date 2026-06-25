import {
  ExpectedContext,
  expectedCountersFor,
  runGate,
  runGateResumeTolerant,
} from "./catalog-batch-gates"
import {
  buildBaseFingerprintPayload,
  computeBaseFingerprint,
  computePlanFingerprint,
  isConfirmationValid,
} from "./catalog-batch-fingerprint"
import { buildCommitCommand, predictExpectedAfter } from "./catalog-batch-report"
import {
  CatalogTotals,
  COMMIT_STAGE_ORDER,
  DbWritesByStage,
  GateResult,
  PipelineConfig,
  PipelineDecision,
  PipelineReport,
  PipelineStage,
  StageCounters,
  StageResult,
} from "./catalog-batch-types"

export interface StageExecution {
  counters: StageCounters
  db_writes: number
  report_path: string | null
  created_product_ids?: string[]
  metadata_updated_ids?: string[]
  projection_created_ids?: string[]
  error?: string | null
}

export interface PipelineDeps {
  runStage: (stage: PipelineStage, startedAt: string) => Promise<StageExecution>
  readTotals: () => Promise<CatalogTotals>
  /** resume: aynı plan_fingerprint'e ait önceki run_id (yoksa null). */
  previousRunId?: (planFingerprint: string) => Promise<string | null>
  now?: () => string
  makeRunId?: () => string
}

const DB_NOTE =
  "db_writes toplamları TEK bir DB transaction'ı anlamına GELMEZ; her commit aşaması kendi Medusa workflow'unu çalıştırır."

const PLAN_STAGES: readonly PipelineStage[] = COMMIT_STAGE_ORDER.filter(
  (s) => s !== "DISCOVERY_DRY_RUN"
)

export async function runCatalogPipeline(
  config: PipelineConfig,
  deps: PipelineDeps
): Promise<PipelineReport> {
  const now = deps.now ?? (() => new Date().toISOString())
  const makeRunId = deps.makeRunId ?? (() => `cbp_${Date.now().toString(36)}`)

  const externalIds = [...config.externalIds].sort()
  const requested = externalIds.length
  const baseFingerprint = computeBaseFingerprint(
    buildBaseFingerprintPayload(externalIds, config.discoveryLimit)
  )
  const startedAt = now()
  const runId = makeRunId()
  const startingTotals = await deps.readTotals()
  const ctx: ExpectedContext = {
    requested,
    productBefore: startingTotals.product,
    productAfter: startingTotals.product + requested,
  }

  const stages: StageResult[] = []
  const createdProductIds: string[] = []
  const metadataUpdatedIds: string[] = []
  const projectionCreatedIds: string[] = []
  const warnings: string[] = []

  const base = (
    decision: PipelineDecision,
    planFingerprint: string | null,
    failureStage: PipelineStage | null,
    resumedFrom: string | null
  ): PipelineReport =>
    finalizeReport({
      runId,
      resumedFrom,
      config,
      externalIds,
      baseFingerprint,
      planFingerprint,
      startedAt,
      finishedAt: now(),
      startingTotals,
      requested,
      stages,
      createdProductIds,
      metadataUpdatedIds,
      projectionCreatedIds,
      warnings,
      failureStage,
      decision,
      endingTotals: null,
    })

  // ── 1) DISCOVERY (her iki modda gerçek dry çalışır) ─────────────────────────
  const discStart = now()
  let disc: StageExecution
  try {
    disc = await deps.runStage("DISCOVERY_DRY_RUN", discStart)
  } catch (err) {
    stages.push(errorStage("DISCOVERY_DRY_RUN", discStart, now(), ctx, err))
    return base(decisionForError(err), null, "DISCOVERY_DRY_RUN", null)
  }
  const discGate = config.resume
    ? runGateResumeTolerant("DISCOVERY_DRY_RUN", ctx, disc.counters)
    : runGate("DISCOVERY_DRY_RUN", ctx, disc.counters)
  stages.push(
    stageResult("DISCOVERY_DRY_RUN", "executed", false, discStart, now(), ctx, disc, discGate)
  )

  const planFingerprint = computePlanFingerprint(baseFingerprint, externalIds, {
    requested: disc.counters.requested_external_ids ?? requested,
    matched: disc.counters.matched_external_ids ?? 0,
    missing: disc.counters.missing ?? 0,
    create: disc.counters.create ?? 0,
    update: disc.counters.update ?? 0,
    review: disc.counters.review ?? 0,
  })

  if (!discGate.ok) {
    return base("PIPELINE_STOPPED_BY_GATE", planFingerprint, "DISCOVERY_DRY_RUN", null)
  }

  // ── DRY-RUN modu: kalanları PLANLA ──────────────────────────────────────────
  if (config.mode === "dry-run") {
    for (const stage of PLAN_STAGES) {
      const est = expectedCountersFor(stage, ctx)
      stages.push({
        stage,
        execution: "planned",
        estimated: true,
        started_at: now(),
        finished_at: now(),
        status: "skipped",
        expected: est,
        actual: est, // tahmini; gerçek sonuç DEĞİL
        gate: { ok: true, reason: "planned", mismatches: [] },
        db_writes: 0, // planlanan → gerçek yazım yok
        report_path: null,
        error: null,
      })
    }
    return base("PIPELINE_DRY_RUN_READY", planFingerprint, null, null)
  }

  // ── COMMIT modu: plan_fingerprint confirmation (discovery'den SONRA) ─────────
  if (!isConfirmationValid(config.confirmToken, planFingerprint)) {
    warnings.push(
      "Commit confirmation (CATALOG_PIPELINE_CONFIRM) güncel plan_fingerprint ile eşleşmedi; plan değişmiş olabilir. Yazım yapılmadı."
    )
    return base("PIPELINE_STALE_PLAN", planFingerprint, null, null)
  }

  let resumedFrom: string | null = null
  if (config.resume && deps.previousRunId) {
    resumedFrom = await deps.previousRunId(planFingerprint)
  }

  // ── COMMIT modu: yazım + idempotency aşamalarını GERÇEK çalıştır ─────────────
  for (const stage of PLAN_STAGES) {
    const stageStart = now()
    let exec: StageExecution
    try {
      exec = await deps.runStage(stage, stageStart)
    } catch (err) {
      stages.push(errorStage(stage, stageStart, now(), ctx, err))
      return base(decisionForError(err), planFingerprint, stage, resumedFrom)
    }
    const gate = config.resume
      ? runGateResumeTolerant(stage, ctx, exec.counters)
      : runGate(stage, ctx, exec.counters)
    const resumed = config.resume && gate.reason === "resumed_no_op"
    if (exec.created_product_ids) createdProductIds.push(...exec.created_product_ids)
    if (exec.metadata_updated_ids) metadataUpdatedIds.push(...exec.metadata_updated_ids)
    if (exec.projection_created_ids) projectionCreatedIds.push(...exec.projection_created_ids)

    const res = stageResult(stage, "executed", false, stageStart, now(), ctx, exec, gate)
    if (resumed) res.status = "resumed_no_op"
    stages.push(res)

    if (res.status === "failed") {
      return base("PIPELINE_STOPPED_BY_GATE", planFingerprint, stage, resumedFrom)
    }
  }

  // dry/idempotency aşamalarının db_writes toplamı 0 olmalı (yazım kuralı)
  const byStage = aggregateDbWrites(stages)
  if (byStage.dry_run_and_idempotency !== 0) {
    return base("PIPELINE_STOPPED_BY_GATE", planFingerprint, null, resumedFrom)
  }

  const endingTotals = await deps.readTotals()
  return finalizeReport({
    runId,
    resumedFrom,
    config,
    externalIds,
    baseFingerprint,
    planFingerprint,
    startedAt,
    finishedAt: now(),
    startingTotals,
    requested,
    stages,
    createdProductIds,
    metadataUpdatedIds,
    projectionCreatedIds,
    warnings,
    failureStage: null,
    decision: "PIPELINE_COMPLETED_AND_IDEMPOTENT",
    endingTotals,
  })
}

// ── yardımcılar ──────────────────────────────────────────────────────────────

function decisionForError(err: unknown): PipelineDecision {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.startsWith("STALE_STAGE_REPORT")) return "PIPELINE_STALE_STAGE_REPORT"
  if (msg.startsWith("PIPELINE_INVALID_REPORT")) return "PIPELINE_INVALID_REPORT"
  if (msg.startsWith("PIPELINE_INVALID_LOCK")) return "PIPELINE_INVALID_LOCK"
  return "PIPELINE_PARTIAL_FAILURE"
}

function stageResult(
  stage: PipelineStage,
  execution: "executed" | "planned",
  estimated: boolean,
  startedAt: string,
  finishedAt: string,
  ctx: ExpectedContext,
  exec: StageExecution,
  gate: GateResult
): StageResult {
  return {
    stage,
    execution,
    estimated,
    started_at: startedAt,
    finished_at: finishedAt,
    status: exec.error ? "failed" : gate.ok ? "passed" : "failed",
    expected: expectedCountersFor(stage, ctx),
    actual: exec.counters,
    gate,
    db_writes: exec.db_writes,
    report_path: exec.report_path,
    error: exec.error ?? (gate.ok ? null : gate.reason),
  }
}

function errorStage(
  stage: PipelineStage,
  startedAt: string,
  finishedAt: string,
  ctx: ExpectedContext,
  err: unknown
): StageResult {
  const message = err instanceof Error ? err.message : String(err)
  return {
    stage,
    execution: "executed",
    estimated: false,
    started_at: startedAt,
    finished_at: finishedAt,
    status: "failed",
    expected: expectedCountersFor(stage, ctx),
    actual: {},
    gate: { ok: false, reason: "stage_error", mismatches: [] },
    db_writes: 0,
    report_path: null,
    error: message,
  }
}

function aggregateDbWrites(stages: StageResult[]): DbWritesByStage {
  const by: DbWritesByStage = {
    sync_commit: 0,
    metadata_commit: 0,
    projection_commit: 0,
    dry_run_and_idempotency: 0,
  }
  for (const s of stages) {
    if (s.execution !== "executed") continue
    if (s.stage === "SYNC_COMMIT") by.sync_commit += s.db_writes
    else if (s.stage === "METADATA_COMMIT") by.metadata_commit += s.db_writes
    else if (s.stage === "PROJECTION_COMMIT") by.projection_commit += s.db_writes
    else by.dry_run_and_idempotency += s.db_writes
  }
  return by
}

interface FinalizeArgs {
  runId: string
  resumedFrom: string | null
  config: PipelineConfig
  externalIds: string[]
  baseFingerprint: string
  planFingerprint: string | null
  startedAt: string
  finishedAt: string
  startingTotals: CatalogTotals
  requested: number
  stages: StageResult[]
  createdProductIds: string[]
  metadataUpdatedIds: string[]
  projectionCreatedIds: string[]
  warnings: string[]
  failureStage: PipelineStage | null
  decision: PipelineDecision
  endingTotals: CatalogTotals | null
}

function finalizeReport(a: FinalizeArgs): PipelineReport {
  const byStage = aggregateDbWrites(a.stages)
  const total =
    byStage.sync_commit +
    byStage.metadata_commit +
    byStage.projection_commit +
    byStage.dry_run_and_idempotency
  const executed = a.stages.filter((s) => s.execution === "executed").map((s) => s.stage)
  const planned = a.stages.filter((s) => s.execution === "planned").map((s) => s.stage)
  return {
    run_id: a.runId,
    resumed_from_run_id: a.resumedFrom,
    mode: a.config.mode,
    external_ids: a.externalIds,
    base_fingerprint: a.baseFingerprint,
    plan_fingerprint: a.planFingerprint,
    resume: a.config.resume,
    started_at: a.startedAt,
    finished_at: a.finishedAt,
    starting_catalog_totals: a.startingTotals,
    ending_catalog_totals: a.endingTotals,
    expected_after: predictExpectedAfter(a.startingTotals, a.requested),
    executed_stages: executed,
    planned_stages: planned,
    stages: a.stages,
    db_writes_by_stage: byStage,
    total_db_writes: total,
    db_writes_note: DB_NOTE,
    created_product_ids: a.createdProductIds,
    metadata_updated_ids: a.metadataUpdatedIds,
    projection_created_ids: a.projectionCreatedIds,
    warnings: a.warnings,
    failure_stage: a.failureStage,
    final_decision: a.decision,
    commit_command:
      a.config.mode === "dry-run" && a.planFingerprint
        ? buildCommitCommand(a.externalIds, a.config.discoveryLimit, a.planFingerprint)
        : null,
  }
}
