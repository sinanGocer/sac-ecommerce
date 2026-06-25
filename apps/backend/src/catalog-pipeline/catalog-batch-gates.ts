import { GateResult, PipelineStage, StageCounters } from "./catalog-batch-types"

/**
 * Aşama gate'leri — SAF. Her aşama için beklenen sayaçları üretir ve gerçek
 * sayaçlarla karşılaştırır. ok=false ise pipeline DURUR (fail-closed).
 *
 * Projection sayaçları sabit toplam varsaymaz; çağıran mevcut DB durumundan
 * türetilen productBefore/productAfter değerlerini geçirir.
 */
export interface ExpectedContext {
  requested: number
  /** batch öncesi toplam aktif product (örn. 25). */
  productBefore: number
  /** batch sonrası toplam aktif product = productBefore + requested. */
  productAfter: number
}

export function expectedCountersFor(
  stage: PipelineStage,
  ctx: ExpectedContext
): StageCounters {
  const r = ctx.requested
  switch (stage) {
    case "DISCOVERY_DRY_RUN":
      return {
        requested_external_ids: r,
        matched_external_ids: r,
        missing: 0,
        selected: r,
        create: r,
        update: 0,
        review: 0,
        create_ready: r,
        batch_size: r,
        workflow_calls: 0,
        db_writes: 0,
      }
    case "SYNC_COMMIT":
      return { workflow_calls: 1, committed: r, db_writes: r, failed: 0 }
    case "SYNC_IDEMPOTENCY":
      return {
        skipped_existing_create_only: r,
        create: 0,
        workflow_calls: 0,
        committed: 0,
        db_writes: 0,
      }
    case "METADATA_DRY_RUN":
      return {
        matched_external_ids: r,
        missing: 0,
        processed: r,
        ready_for_v2: r,
        needs_review: 0,
        rejected: 0,
        identity_conflicts: 0,
        taxonomy_errors: 0,
        parser_errors: 0,
        db_writes: 0,
      }
    case "METADATA_COMMIT":
      return {
        eligible: r,
        updated: r,
        unchanged: 0,
        stale_plan: 0,
        failed: 0,
        db_writes: r,
      }
    case "METADATA_IDEMPOTENCY":
      return {
        updated: 0,
        unchanged: r,
        stale_plan: 0,
        failed: 0,
        db_writes: 0,
      }
    case "PROJECTION_DRY_RUN":
      return {
        processed: ctx.productAfter,
        created: r,
        updated: 0,
        failed: 0,
        db_writes: 0,
      }
    case "PROJECTION_COMMIT":
      return { created: r, updated: 0, failed: 0, db_writes: r }
    case "PROJECTION_IDEMPOTENCY":
      return {
        created: 0,
        updated: 0,
        unchanged: ctx.productAfter,
        failed: 0,
        db_writes: 0,
      }
    default:
      return {}
  }
}

/** Beklenen ile gerçek sayaçları karşılaştırır (yalnız beklenen alanlar). */
export function checkGate(
  expected: StageCounters,
  actual: StageCounters
): GateResult {
  const mismatches: GateResult["mismatches"] = []
  for (const field of Object.keys(expected)) {
    const exp = expected[field]
    const act = actual[field]
    if (act !== exp) {
      mismatches.push({ field, expected: exp, actual: act ?? NaN })
    }
  }
  return {
    ok: mismatches.length === 0,
    reason:
      mismatches.length === 0
        ? null
        : `gate_mismatch:${mismatches.map((m) => m.field).join(",")}`,
    mismatches,
  }
}

export function runGate(
  stage: PipelineStage,
  ctx: ExpectedContext,
  actual: StageCounters
): GateResult {
  return checkGate(expectedCountersFor(stage, ctx), actual)
}

/**
 * Resume modunda commit aşamaları için "zaten uygulanmış" (idempotent no-op)
 * beklentisi. Yalnız create/commit aşamalarında geçerlidir; null ise no-op
 * toleransı yoktur (yani strict gate uygulanır).
 */
export function noOpExpectedFor(
  stage: PipelineStage,
  ctx: ExpectedContext
): StageCounters | null {
  switch (stage) {
    case "DISCOVERY_DRY_RUN":
      // zaten import edilmiş: create-only skip
      return {
        requested_external_ids: ctx.requested,
        matched_external_ids: ctx.requested,
        missing: 0,
        skipped_existing_create_only: ctx.requested,
        create: 0,
        workflow_calls: 0,
        db_writes: 0,
      }
    case "SYNC_COMMIT":
      return { workflow_calls: 0, committed: 0, db_writes: 0, failed: 0 }
    case "METADATA_COMMIT":
      return {
        updated: 0,
        unchanged: ctx.requested,
        stale_plan: 0,
        failed: 0,
        db_writes: 0,
      }
    case "PROJECTION_DRY_RUN":
      // zaten projection'da: create yok
      return { created: 0, updated: 0, failed: 0, db_writes: 0 }
    case "PROJECTION_COMMIT":
      return { created: 0, updated: 0, failed: 0, db_writes: 0 }
    default:
      return null
  }
}

/**
 * Resume-toleranslı gate: önce strict; geçmezse (yalnız commit aşamaları için)
 * idempotent no-op beklentisini dener. İkisi de geçmezse fail-closed.
 */
export function runGateResumeTolerant(
  stage: PipelineStage,
  ctx: ExpectedContext,
  actual: StageCounters
): GateResult {
  const strict = runGate(stage, ctx, actual)
  if (strict.ok) return strict
  const noop = noOpExpectedFor(stage, ctx)
  if (!noop) return strict
  const noopResult = checkGate(noop, actual)
  if (noopResult.ok) {
    return { ok: true, reason: "resumed_no_op", mismatches: [] }
  }
  return strict
}
