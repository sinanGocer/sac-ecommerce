import { createHash } from "crypto"

import { PROJECTION_SCHEMA_VERSION } from "../modules/search-projection/search-projection.types"
import { parseExternalIdAllowlist } from "../product-sync/utils/sync-config"

/** Politika/şema sürümleri — değişirse fingerprint değişir (eski confirm geçersiz). */
export const PIPELINE_SCHEMA_VERSION = 1
export const LOCK_POLICY_VERSION = 2
export const SYNC_SELECTION_POLICY_VERSION = 1
export const METADATA_POLICY_VERSION = 1

export interface BaseFingerprintPayload {
  pipeline_schema_version: number
  lock_policy_version: number
  normalized_external_ids: string[]
  discovery_limit: number
  create_only: true
  sync_selection_policy_version: number
  metadata_policy_version: number
  projection_schema_version: number
}

export type FingerprintPolicy = Pick<
  BaseFingerprintPayload,
  | "pipeline_schema_version"
  | "lock_policy_version"
  | "sync_selection_policy_version"
  | "metadata_policy_version"
  | "projection_schema_version"
>

export interface PlanSummary {
  requested: number
  matched: number
  missing: number
  create: number
  update: number
  review: number
}

/** Trim/boş-at/dedupe/geçersiz→hata, ardından sort (deterministik). */
export function normalizeExternalIds(raw: string | undefined | null): string[] {
  const set = parseExternalIdAllowlist(raw)
  if (!set) {
    throw new Error(
      "[catalog:batch] CATALOG_EXTERNAL_IDS zorunlu (hedef external_id'ler)."
    )
  }
  return [...set].sort()
}

function sha16(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16)
}

/**
 * Base fingerprint — yalnız ID listesi değil; discovery limit + create-only +
 * şema/politika sürümleri dahil. Timestamp/run_id/dosya yolu GİRMEZ.
 */
function dedupeSorted(ids: string[]): string[] {
  return [...new Set(ids)].sort()
}

export function buildBaseFingerprintPayload(
  normalizedIds: string[],
  discoveryLimit: number,
  lockPolicyVersion = LOCK_POLICY_VERSION
): BaseFingerprintPayload {
  return {
    pipeline_schema_version: PIPELINE_SCHEMA_VERSION,
    lock_policy_version: lockPolicyVersion,
    normalized_external_ids: dedupeSorted(normalizedIds),
    discovery_limit: discoveryLimit,
    create_only: true,
    sync_selection_policy_version: SYNC_SELECTION_POLICY_VERSION,
    metadata_policy_version: METADATA_POLICY_VERSION,
    projection_schema_version: PROJECTION_SCHEMA_VERSION,
  }
}

export function computeBaseFingerprint(payload: BaseFingerprintPayload): string {
  // Anahtarları sıralı serialize et → deterministik.
  const canonical = JSON.stringify({
    pipeline_schema_version: payload.pipeline_schema_version,
    lock_policy_version: payload.lock_policy_version,
    normalized_external_ids: [...payload.normalized_external_ids].sort(),
    discovery_limit: payload.discovery_limit,
    create_only: payload.create_only,
    sync_selection_policy_version: payload.sync_selection_policy_version,
    metadata_policy_version: payload.metadata_policy_version,
    projection_schema_version: payload.projection_schema_version,
  })
  return sha16(canonical)
}

export function fingerprintPolicy(
  payload: BaseFingerprintPayload
): FingerprintPolicy {
  return {
    pipeline_schema_version: payload.pipeline_schema_version,
    lock_policy_version: payload.lock_policy_version,
    sync_selection_policy_version: payload.sync_selection_policy_version,
    metadata_policy_version: payload.metadata_policy_version,
    projection_schema_version: payload.projection_schema_version,
  }
}

/**
 * Plan fingerprint — base + dry-run plan sayaçları. Aynı ID'lerle farklı
 * discovery sonucu çıkarsa (örn. bir ürün artık review/update) plan_fingerprint
 * değişir → eski commit confirmation geçersiz olur.
 */
export function computePlanFingerprint(
  baseFingerprint: string,
  normalizedIds: string[],
  plan: PlanSummary
): string {
  const canonical = JSON.stringify({
    base_fingerprint: baseFingerprint,
    normalized_external_ids: [...normalizedIds].sort(),
    requested: plan.requested,
    matched: plan.matched,
    missing: plan.missing,
    create: plan.create,
    update: plan.update,
    review: plan.review,
  })
  return sha16(canonical)
}

/** Commit confirmation: token plan_fingerprint ile birebir olmalı. */
export function isConfirmationValid(
  confirmToken: string | null | undefined,
  planFingerprint: string
): boolean {
  if (!confirmToken) return false
  return confirmToken.trim() === planFingerprint
}
