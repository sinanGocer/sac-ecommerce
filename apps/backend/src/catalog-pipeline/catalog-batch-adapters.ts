import { StageCounters } from "./catalog-batch-types"

/**
 * Typed report adapter'ları — raw JSON'a dağınık erişme yerine fail-closed
 * doğrulama. Eksik alan / yanlış tip / negatif / NaN/Infinity / string-sayı /
 * tutarsız toplam / yanlış mode-scope → PIPELINE_INVALID_REPORT ile fırlatır.
 */

export class InvalidReportError extends Error {
  constructor(reason: string) {
    super(`PIPELINE_INVALID_REPORT: ${reason}`)
    this.name = "InvalidReportError"
  }
}

export interface AdaptedStageResult {
  schema_version: number | null
  counters: StageCounters
}

function obj(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new InvalidReportError("report_not_object")
  }
  return value as Record<string, unknown>
}

/** Sayaç: number, sonlu, tam, negatif değil. String-sayı sessizce kabul edilmez. */
function count(o: Record<string, unknown>, key: string): number {
  const v = o[key]
  if (typeof v !== "number") throw new InvalidReportError(`not_number:${key}`)
  if (!Number.isFinite(v)) throw new InvalidReportError(`nan_or_infinity:${key}`)
  if (!Number.isInteger(v)) throw new InvalidReportError(`not_integer:${key}`)
  if (v < 0) throw new InvalidReportError(`negative:${key}`)
  return v
}

function expectEquals(
  o: Record<string, unknown>,
  key: string,
  value: string | boolean,
  label: string
): void {
  if (o[key] !== value) throw new InvalidReportError(`${label}:${key}`)
}

function arrayLen(o: Record<string, unknown>, key: string): number {
  const v = o[key]
  if (!Array.isArray(v)) throw new InvalidReportError(`not_array:${key}`)
  return v.length
}

function schemaVersion(report: Record<string, unknown>): number | null {
  const v =
    report.report_schema_version ?? report.projection_schema_version ?? null
  return typeof v === "number" ? v : null
}

export interface SyncExpect {
  requested: number
  dryRun: boolean
}

export function readSyncStageResult(
  raw: Record<string, unknown> | null,
  expect: SyncExpect
): AdaptedStageResult {
  const report = obj(raw)
  const s = obj(report.summary)
  // mode/scope
  expectEquals(report, "dryRun", expect.dryRun, "mode_mismatch")
  if (!expect.dryRun) expectEquals(s, "commit_enabled", true, "mode_mismatch")
  const requested = count(s, "requested_external_ids")
  if (requested !== expect.requested) {
    throw new InvalidReportError("scope_requested_mismatch")
  }
  const matched = count(s, "matched_external_ids")
  if (requested < matched) throw new InvalidReportError("requested_lt_matched")
  const missing = arrayLen(s, "missing_requested_external_ids")
  if (missing !== requested - matched) {
    throw new InvalidReportError("missing_not_requested_minus_matched")
  }
  const counters: StageCounters = {
    requested_external_ids: requested,
    matched_external_ids: matched,
    missing,
    selected: count(s, "selected"),
    create: count(s, "create"),
    update: count(s, "update"),
    review: count(s, "review"),
    skipped_existing_create_only: count(s, "skipped_existing_create_only"),
    create_ready: count(s, "create_ready"),
    batch_size: count(s, "batch_size"),
    workflow_calls: count(s, "workflow_calls"),
    committed: count(s, "committed"),
    db_writes: count(s, "db_writes"),
    failed: count(s, "failed"),
  }
  return { schema_version: schemaVersion(report), counters }
}

export interface MetadataExpect {
  mode: "dry-run" | "commit"
  requested?: number
}

export function readMetadataStageResult(
  raw: Record<string, unknown> | null,
  expect: MetadataExpect
): AdaptedStageResult {
  const report = obj(raw)
  expectEquals(report, "mode", expect.mode, "mode_mismatch")
  const t = obj(report.totals)

  if (expect.mode === "dry-run") {
    const scope = obj(report.scope)
    const matched = count(scope, "matched_external_ids")
    const missing = arrayLen(scope, "missing_external_ids")
    if (expect.requested !== undefined && matched !== expect.requested) {
      throw new InvalidReportError("scope_requested_mismatch")
    }
    const processed = count(t, "processed")
    const ready = count(t, "ready_for_v2")
    const review = count(t, "needs_review")
    const rejected = count(t, "rejected")
    if (processed < ready + review + rejected) {
      throw new InvalidReportError("processed_lt_sum")
    }
    return {
      schema_version: schemaVersion(report),
      counters: {
        matched_external_ids: matched,
        missing,
        processed,
        ready_for_v2: ready,
        needs_review: review,
        rejected,
        identity_conflicts: count(t, "identity_conflicts"),
        taxonomy_errors: count(t, "taxonomy_errors"),
        parser_errors: count(t, "parser_errors"),
        db_writes: count(t, "db_writes"),
      },
    }
  }

  // commit
  expectEquals(report, "dry_run", false, "mode_mismatch")
  const processed = count(t, "processed")
  const updated = count(t, "updated")
  const unchanged = count(t, "unchanged")
  const skipped = count(t, "skipped")
  const stale = count(t, "stale_plan")
  const failed = count(t, "failed")
  if (processed < updated + unchanged + skipped + stale + failed) {
    throw new InvalidReportError("processed_lt_sum")
  }
  return {
    schema_version: schemaVersion(report),
    counters: {
      eligible: count(t, "eligible"),
      updated,
      unchanged,
      stale_plan: stale,
      failed,
      db_writes: count(t, "db_writes"),
    },
  }
}

export interface ProjectionExpect {
  mode: "dry-run" | "commit"
}

export function readProjectionStageResult(
  raw: Record<string, unknown> | null,
  expect: ProjectionExpect
): AdaptedStageResult {
  const report = obj(raw)
  expectEquals(report, "mode", expect.mode, "mode_mismatch")
  const t = obj(report.totals)
  const processed = count(t, "processed")
  const created = count(t, "created")
  const updated = count(t, "updated")
  const unchanged = count(t, "unchanged")
  if (processed < created + updated + unchanged) {
    throw new InvalidReportError("processed_lt_sum")
  }
  return {
    schema_version: schemaVersion(report),
    counters: {
      processed,
      created,
      updated,
      unchanged,
      failed: count(t, "failed"),
      db_writes: count(t, "db_writes"),
    },
  }
}
