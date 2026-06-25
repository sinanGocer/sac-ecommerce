/**
 * Catalog Batch Pipeline — tipler. Orchestrator mevcut servisleri yeniden
 * kullanır; bu dosya saf tip + sayaç + karar sözleşmesini tanımlar.
 */

export type PipelineStage =
  | "DISCOVERY_DRY_RUN"
  | "SYNC_COMMIT"
  | "SYNC_IDEMPOTENCY"
  | "METADATA_DRY_RUN"
  | "METADATA_COMMIT"
  | "METADATA_IDEMPOTENCY"
  | "PROJECTION_DRY_RUN"
  | "PROJECTION_COMMIT"
  | "PROJECTION_IDEMPOTENCY"

export const COMMIT_STAGE_ORDER: readonly PipelineStage[] = [
  "DISCOVERY_DRY_RUN",
  "SYNC_COMMIT",
  "SYNC_IDEMPOTENCY",
  "METADATA_DRY_RUN",
  "METADATA_COMMIT",
  "METADATA_IDEMPOTENCY",
  "PROJECTION_DRY_RUN",
  "PROJECTION_COMMIT",
  "PROJECTION_IDEMPOTENCY",
]

/** Gerçek DB yazımı yapan aşamalar. */
export const WRITE_STAGES: ReadonlySet<PipelineStage> = new Set<PipelineStage>([
  "SYNC_COMMIT",
  "METADATA_COMMIT",
  "PROJECTION_COMMIT",
])

export type StageStatus = "passed" | "failed" | "skipped" | "resumed_no_op"
export type StageExecutionMode = "executed" | "planned"
export type StageCounters = Record<string, number>

export interface GateResult {
  ok: boolean
  reason: string | null
  mismatches: Array<{ field: string; expected: number; actual: number }>
}

export interface StageResult {
  stage: PipelineStage
  execution: StageExecutionMode
  estimated: boolean
  started_at: string
  finished_at: string
  status: StageStatus
  expected: StageCounters
  actual: StageCounters
  gate: GateResult
  db_writes: number
  report_path: string | null
  error: string | null
}

export interface CatalogTotals {
  product: number
  aveda: number
  aveda_metadata_v2: number
  salon_seed_v1: number
  projection_rows: number
}

export type PipelineMode = "dry-run" | "commit"

export interface PipelineConfig {
  externalIds: string[]
  discoveryLimit: number
  mode: PipelineMode
  /** commit modunda zorunlu: plan_fingerprint ile birebir. */
  confirmToken: string | null
  resume: boolean
}

/** Standart karar sözleşmesi (item 7). */
export type PipelineDecision =
  | "PIPELINE_DRY_RUN_READY"
  | "PIPELINE_COMPLETED_AND_IDEMPOTENT"
  | "PIPELINE_STOPPED_BY_GATE"
  | "PIPELINE_STALE_PLAN"
  | "PIPELINE_PARTIAL_FAILURE"
  | "PIPELINE_ALREADY_RUNNING"
  | "PIPELINE_STALE_STAGE_REPORT"
  | "PIPELINE_INVALID_LOCK"
  | "PIPELINE_INVALID_REPORT"

export interface DbWritesByStage {
  sync_commit: number
  metadata_commit: number
  projection_commit: number
  dry_run_and_idempotency: number
}

export interface PipelineReport {
  run_id: string
  resumed_from_run_id: string | null
  mode: PipelineMode
  external_ids: string[]
  /** yapısal payload'dan üretilen kalıcı kimlik (ID listesi tek başına değil). */
  base_fingerprint: string
  /** dry-run plan sayaçlarını da kapsayan commit confirmation kimliği. */
  plan_fingerprint: string | null
  resume: boolean
  started_at: string
  finished_at: string
  starting_catalog_totals: CatalogTotals | null
  ending_catalog_totals: CatalogTotals | null
  expected_after: {
    product_total: number
    aveda_metadata_v2_total: number
    projection_total: number
  }
  executed_stages: PipelineStage[]
  planned_stages: PipelineStage[]
  stages: StageResult[]
  db_writes_by_stage: DbWritesByStage
  total_db_writes: number
  /** Not: bu toplam TEK bir DB transaction'ı anlamına GELMEZ. */
  db_writes_note: string
  created_product_ids: string[]
  metadata_updated_ids: string[]
  projection_created_ids: string[]
  warnings: string[]
  failure_stage: PipelineStage | null
  final_decision: PipelineDecision
  /** dry-run sonunda commit için gereken kesin komut (plan_fingerprint ile). */
  commit_command: string | null
}
