import { promises as fs } from "fs"
import path from "path"

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import syncAveda from "../product-sync/scripts/sync-aveda"
import avedaMetadataV2Dry from "../product-sync/scripts/aveda-metadata-v2-dry"
import avedaMetadataV2Commit from "../product-sync/scripts/aveda-metadata-v2-commit"
import searchBackfill from "../modules/search-projection/scripts/search-backfill"
import {
  AdaptedStageResult,
  readMetadataStageResult,
  readProjectionStageResult,
  readSyncStageResult,
} from "../catalog-pipeline/catalog-batch-adapters"
import { withTemporaryEnv } from "../catalog-pipeline/catalog-batch-env"
import {
  buildBaseFingerprintPayload,
  computeBaseFingerprint,
  fingerprintPolicy,
  normalizeExternalIds,
} from "../catalog-pipeline/catalog-batch-fingerprint"
import {
  FileSignature,
  checkReportFreshness,
  fileChanged,
} from "../catalog-pipeline/catalog-batch-freshness"
import {
  PipelineLock,
  acquirePipelineLock,
  releasePipelineLock,
} from "../catalog-pipeline/catalog-batch-lock"
import {
  PipelineDeps,
  StageExecution,
  runCatalogPipeline,
} from "../catalog-pipeline/catalog-batch-pipeline"
import {
  CatalogTotals,
  PipelineConfig,
  PipelineReport,
  PipelineStage,
} from "../catalog-pipeline/catalog-batch-types"

const REPORTS_DIR = path.resolve(process.cwd(), "catalog-pipeline-reports")
const LATEST_REPORT = path.join(REPORTS_DIR, "catalog-batch-latest.json")
const LOCK_PATH = path.join(REPORTS_DIR, "catalog-batch.lock")
const RECOVERY_LOCK_PATH = `${LOCK_PATH}.recovery`
const LOCK_STALE_MS = 60 * 60 * 1000
const RECOVERY_LOCK_STALE_MS = 5 * 60 * 1000
const SYNC_REPORT = "sync-reports/aveda-latest.json"
const V2_DRY_REPORT = "metadata-v2-reports/aveda-metadata-v2-latest.json"
const V2_COMMIT_REPORT = "metadata-v2-reports/aveda-metadata-v2-commit-latest.json"
const PROJECTION_REPORT = "search-reports/search-backfill-latest.json"

export default async function catalogBatch({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const externalIds = normalizeExternalIds(process.env.CATALOG_EXTERNAL_IDS)
  const requested = externalIds.length
  const discoveryLimit = parsePositiveInt(process.env.CATALOG_DISCOVERY_LIMIT, 50)
  const commit = process.env.CATALOG_PIPELINE_COMMIT === "true"
  const fingerprintPayload = buildBaseFingerprintPayload(
    externalIds,
    discoveryLimit
  )
  const baseFingerprint = computeBaseFingerprint(fingerprintPayload)
  const runId = `cbp_${Date.now().toString(36)}_${baseFingerprint.slice(0, 6)}`
  const allowlistCsv = [...externalIds].sort().join(",")

  const config: PipelineConfig = {
    externalIds,
    discoveryLimit,
    mode: commit ? "commit" : "dry-run",
    confirmToken: process.env.CATALOG_PIPELINE_CONFIRM ?? null,
    resume: process.env.CATALOG_PIPELINE_RESUME === "true",
  }

  const runStage = async (
    stage: PipelineStage,
    startedAt: string
  ): Promise<StageExecution> => {
    logger.info(`[catalog:batch] ▶ ${stage}`)
    const startMs = Date.parse(startedAt)
    switch (stage) {
      case "DISCOVERY_DRY_RUN":
        return runSync(container, allowlistCsv, discoveryLimit, requested, startMs, true, false)
      case "SYNC_COMMIT":
      case "SYNC_IDEMPOTENCY":
        return runSync(container, allowlistCsv, discoveryLimit, requested, startMs, false, stage === "SYNC_COMMIT")
      case "METADATA_DRY_RUN":
        return runV2Dry(container, allowlistCsv, requested, startMs)
      case "METADATA_COMMIT":
      case "METADATA_IDEMPOTENCY":
        return runV2Commit(container, allowlistCsv, startMs, stage === "METADATA_COMMIT")
      case "PROJECTION_DRY_RUN":
        return runProjection(container, false, startMs)
      case "PROJECTION_COMMIT":
      case "PROJECTION_IDEMPOTENCY":
        return runProjection(container, true, startMs)
      default:
        throw new Error(`[catalog:batch] Bilinmeyen aşama: ${stage}`)
    }
  }

  const deps: PipelineDeps = {
    runStage,
    readTotals: () => readCatalogTotals(query),
    previousRunId: (planFp) => loadPreviousRunId(planFp),
    makeRunId: () => runId,
  }

  let report: PipelineReport
  if (config.mode === "commit") {
    const lockOwner: PipelineLock = {
      run_id: runId,
      pid: process.pid,
      started_at: new Date().toISOString(),
      fingerprint: baseFingerprint,
    }
    const lock = await acquirePipelineLock({
      paths: {
        lockPath: LOCK_PATH,
        recoveryPath: RECOVERY_LOCK_PATH,
      },
      lock: lockOwner,
      lockStaleMs: LOCK_STALE_MS,
      recoveryStaleMs: RECOVERY_LOCK_STALE_MS,
    })
    if (!lock.ok) {
      report = await writeBlockedReport(
        runId,
        externalIds,
        baseFingerprint,
        discoveryLimit,
        lock.decision,
        `${lock.reason}. Lock dosyaları otomatik olarak yalnız sahiplik ve stale doğrulamasıyla değiştirilir.`
      )
      logSummary(logger, report)
      return
    }
    try {
      report = await runCatalogPipeline(config, deps)
    } finally {
      await releasePipelineLock(LOCK_PATH, lockOwner)
    }
  } else {
    report = await runCatalogPipeline(config, deps)
  }

  await writeReport(report)
  logSummary(logger, report)
}

// ── Aşama çalıştırıcıları (mevcut exec fn + freshness + adapter) ─────────────

async function runSync(
  container: ExecArgs["container"],
  allowlistCsv: string,
  limit: number,
  requested: number,
  startMs: number,
  dryRun: boolean,
  collectCreated: boolean
): Promise<StageExecution> {
  const before = await fileSignature(SYNC_REPORT)
  await withTemporaryEnv(
    process.env,
    {
      SYNC_ONLY_EXTERNAL_IDS: allowlistCsv,
      SYNC_CREATE_ONLY: "true",
      SYNC_LIMIT: String(limit),
      SYNC_DRY_RUN: dryRun ? "true" : "false",
      SYNC_COMMIT: dryRun ? null : "true",
    },
    () => syncAveda({ container } as ExecArgs)
  )
  const raw = await assertFresh(SYNC_REPORT, before, startMs, ["finishedAt"])
  const adapted: AdaptedStageResult = readSyncStageResult(raw, { requested, dryRun })
  const created: string[] = []
  if (collectCreated && Array.isArray(raw.results)) {
    for (const r of raw.results as Array<Record<string, unknown>>) {
      if (r.committed === true && typeof r.committedId === "string") created.push(r.committedId)
    }
  }
  return {
    counters: adapted.counters,
    db_writes: adapted.counters.db_writes,
    report_path: SYNC_REPORT,
    created_product_ids: created,
  }
}

async function runV2Dry(
  container: ExecArgs["container"],
  allowlistCsv: string,
  requested: number,
  startMs: number
): Promise<StageExecution> {
  const before = await fileSignature(V2_DRY_REPORT)
  await withTemporaryEnv(process.env, { SYNC_ONLY_EXTERNAL_IDS: allowlistCsv }, () =>
    avedaMetadataV2Dry({ container } as ExecArgs)
  )
  const raw = await assertFresh(V2_DRY_REPORT, before, startMs, ["generatedAt"])
  const adapted = readMetadataStageResult(raw, { mode: "dry-run", requested })
  return { counters: adapted.counters, db_writes: adapted.counters.db_writes, report_path: V2_DRY_REPORT }
}

async function runV2Commit(
  container: ExecArgs["container"],
  allowlistCsv: string,
  startMs: number,
  collectUpdated: boolean
): Promise<StageExecution> {
  const before = await fileSignature(V2_COMMIT_REPORT)
  await withTemporaryEnv(
    process.env,
    {
      SYNC_ONLY_EXTERNAL_IDS: allowlistCsv,
      AVEDA_METADATA_V2_COMMIT: "true",
      AVEDA_METADATA_V2_DRY_RUN: "false",
    },
    () => avedaMetadataV2Commit({ container } as ExecArgs)
  )
  const raw = await assertFresh(V2_COMMIT_REPORT, before, startMs, ["generatedAt"])
  const adapted = readMetadataStageResult(raw, { mode: "commit" })
  const updated: string[] = []
  if (collectUpdated && Array.isArray(raw.products)) {
    for (const p of raw.products as Array<Record<string, unknown>>) {
      if (p.status === "updated" && typeof p.product_id === "string") updated.push(p.product_id)
    }
  }
  return {
    counters: adapted.counters,
    db_writes: adapted.counters.db_writes,
    report_path: V2_COMMIT_REPORT,
    metadata_updated_ids: updated,
  }
}

async function runProjection(
  container: ExecArgs["container"],
  commit: boolean,
  startMs: number
): Promise<StageExecution> {
  const before = await fileSignature(PROJECTION_REPORT)
  await withTemporaryEnv(process.env, { SEARCH_COMMIT: commit ? "true" : null }, () =>
    searchBackfill({ container } as ExecArgs)
  )
  const raw = await assertFresh(PROJECTION_REPORT, before, startMs, ["generatedAt"])
  const adapted = readProjectionStageResult(raw, { mode: commit ? "commit" : "dry-run" })
  return { counters: adapted.counters, db_writes: adapted.counters.db_writes, report_path: PROJECTION_REPORT }
}

// ── freshness (dosya imzası + içsel timestamp) ──────────────────────────────

async function fileSignature(rel: string): Promise<FileSignature> {
  try {
    const st = await fs.stat(path.resolve(process.cwd(), rel))
    return { exists: true, mtimeMs: st.mtimeMs, size: st.size }
  } catch {
    return { exists: false, mtimeMs: 0, size: 0 }
  }
}

async function assertFresh(
  rel: string,
  before: FileSignature,
  startMs: number,
  timestampFields: string[]
): Promise<Record<string, unknown>> {
  const after = await fileSignature(rel)
  if (!fileChanged(before, after)) {
    throw new Error(`STALE_STAGE_REPORT: ${rel} (file_not_refreshed)`)
  }
  const raw = await readJson(rel)
  const fresh = checkReportFreshness(raw, { stageStartedAtMs: startMs, timestampFields, expect: [] })
  if (!fresh.ok) throw new Error(`STALE_STAGE_REPORT: ${rel} (${fresh.reason})`)
  return raw as Record<string, unknown>
}

// ── DB katalog toplamları (read-only) ──────────────────────────────────────

async function readCatalogTotals(query: {
  graph: (args: {
    entity: string
    fields: string[]
    pagination?: { skip: number; take: number }
  }) => Promise<{ data?: unknown[] }>
}): Promise<CatalogTotals> {
  let product = 0
  let aveda = 0
  let v2 = 0
  let skip = 0
  const take = 200
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data } = await query.graph({
      entity: "product",
      fields: ["id", "metadata"],
      pagination: { skip, take },
    })
    const rows = (data ?? []) as Array<{ metadata?: Record<string, unknown> | null }>
    if (rows.length === 0) break
    for (const row of rows) {
      product++
      const m = row.metadata ?? {}
      if (m.sync_provider === "aveda") {
        aveda++
        if (m.metadata_version === 2) v2++
      }
    }
    skip += rows.length
    if (rows.length < take) break
  }

  let projectionRows = product
  try {
    const { data } = await query.graph({ entity: "product_search_projection", fields: ["id"] })
    projectionRows = (data ?? []).length
  } catch {
    projectionRows = product
  }
  return {
    product,
    aveda,
    aveda_metadata_v2: v2,
    salon_seed_v1: product - aveda,
    projection_rows: projectionRows,
  }
}

// ── resume önceki rapor ──────────────────────────────────────────────────────

async function loadPreviousRunId(planFingerprint: string): Promise<string | null> {
  const raw = await readJsonAbs(LATEST_REPORT)
  if (!raw) return null
  if (typeof raw.plan_fingerprint !== "string" || typeof raw.run_id !== "string") {
    return null
  }
  return raw.plan_fingerprint === planFingerprint ? raw.run_id : null
}

// ── rapor yazımı & yardımcılar ──────────────────────────────────────────────

async function writeReport(report: PipelineReport): Promise<void> {
  await fs.mkdir(REPORTS_DIR, { recursive: true })
  const stamp = report.finished_at.replace(/[:.]/g, "-")
  const json = JSON.stringify(report, null, 2)
  await fs.writeFile(path.join(REPORTS_DIR, `catalog-batch-${stamp}-${report.base_fingerprint}.json`), json, "utf-8")
  await fs.writeFile(LATEST_REPORT, json, "utf-8")
}

async function writeBlockedReport(
  runId: string,
  externalIds: string[],
  baseFingerprint: string,
  discoveryLimit: number,
  decision: PipelineReport["final_decision"],
  warning: string
): Promise<PipelineReport> {
  const nowIso = new Date().toISOString()
  const report: PipelineReport = {
    run_id: runId,
    resumed_from_run_id: null,
    mode: "commit",
    external_ids: externalIds,
    base_fingerprint: baseFingerprint,
    fingerprint_policy: fingerprintPolicy(
      buildBaseFingerprintPayload(externalIds, discoveryLimit)
    ),
    plan_fingerprint: null,
    resume: false,
    started_at: nowIso,
    finished_at: nowIso,
    starting_catalog_totals: null,
    ending_catalog_totals: null,
    expected_after: { product_total: 0, aveda_metadata_v2_total: 0, projection_total: 0 },
    executed_stages: [],
    planned_stages: [],
    stages: [],
    db_writes_by_stage: { sync_commit: 0, metadata_commit: 0, projection_commit: 0, dry_run_and_idempotency: 0 },
    total_db_writes: 0,
    db_writes_note: "Yazım yapılmadı.",
    created_product_ids: [],
    metadata_updated_ids: [],
    projection_created_ids: [],
    warnings: [warning],
    failure_stage: null,
    final_decision: decision,
    commit_command: null,
  }
  await writeReport(report)
  return report
}

async function readJson(rel: string): Promise<Record<string, unknown> | null> {
  return readJsonAbs(path.resolve(process.cwd(), rel))
}

async function readJsonAbs(abs: string): Promise<Record<string, unknown> | null> {
  try {
    const buf = await fs.readFile(abs, "utf-8")
    const parsed: unknown = JSON.parse(buf)
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function logSummary(logger: { info: (m: string) => void; warn: (m: string) => void }, report: PipelineReport): void {
  logger.info("──────────── CATALOG BATCH ÖZET ────────────")
  logger.info(
    `mode=${report.mode} decision=${report.final_decision} base_fp=${report.base_fingerprint} plan_fp=${report.plan_fingerprint ?? "-"} total_db_writes=${report.total_db_writes} failure_stage=${report.failure_stage ?? "-"}`
  )
  if (report.warnings.length > 0) report.warnings.forEach((w) => logger.warn(`[catalog:batch] ${w}`))
  if (report.final_decision === "PIPELINE_DRY_RUN_READY" && report.commit_command) {
    logger.info(`Commit komutu: ${report.commit_command}`)
  }
  logger.info("Rapor: catalog-pipeline-reports/catalog-batch-latest.json")
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = value ? parseInt(value, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
