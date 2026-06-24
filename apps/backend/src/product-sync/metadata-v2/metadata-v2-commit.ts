import { ProductV2Plan, V2_PATCH_FIELDS } from "./metadata-v2.types"
import { metadataFingerprint } from "./metadata-v2-fingerprint"

export type CommitGuard = {
  commit_enabled: boolean
  dry_run: boolean
}

export type CommitProductStatus =
  | "updated"
  | "unchanged"
  | "skipped"
  | "stale_plan"
  | "failed"

export interface CurrentProductState {
  id: string
  handle: string | null
  metadata: Record<string, unknown>
}

export interface CommitProductResult {
  product_id: string
  handle: string | null
  identity_verified: boolean
  metadata_fingerprint_before: string
  metadata_fingerprint_after: string | null
  proposed_patch: Record<string, unknown>
  fields_changed: string[]
  fields_preserved: string[]
  metadata_version_before: number | null
  metadata_version_after: number | null
  status: CommitProductStatus
  error: string | null
  price_untouched: true
  images_untouched: true
  variants_untouched: true
}

export interface CommitReport {
  report_schema_version: 1
  generatedAt: string
  mode: "commit"
  commit_enabled: boolean
  dry_run: boolean
  totals: {
    processed: number
    eligible: number
    updated: number
    unchanged: number
    skipped: number
    stale_plan: number
    failed: number
    db_writes: number
  }
  products: CommitProductResult[]
}

export type MetadataUpdater = (
  productId: string,
  mergedMetadata: Record<string, unknown>
) => Promise<void>

export function resolveCommitGuard(
  env: Record<string, string | undefined>
): CommitGuard {
  const commitEnabled = env.AVEDA_METADATA_V2_COMMIT === "true"
  const dryRun = env.AVEDA_METADATA_V2_DRY_RUN !== "false"
  return {
    commit_enabled: commitEnabled && !dryRun,
    dry_run: dryRun,
  }
}

/**
 * Commit scope fail-closed doğrulaması. Allowlist ile hedefleme yapıldığında
 * planner raporundaki scope, istenen TÜM external_id'lerin eşleştiğini garanti
 * etmeli; aksi halde writer çağrılmamalı (DB write 0).
 */
export function verifyCommitScope(
  scope:
    | {
        requested_external_ids: number
        matched_external_ids: number
        missing_external_ids: string[]
      }
    | null
    | undefined
): { ok: boolean; reason: string | null } {
  if (!scope) return { ok: false, reason: "scope_missing" }
  if (scope.requested_external_ids === 0) {
    return { ok: false, reason: "empty_scope" }
  }
  if (scope.missing_external_ids.length > 0) {
    return { ok: false, reason: "missing_requested_ids" }
  }
  if (scope.matched_external_ids !== scope.requested_external_ids) {
    return { ok: false, reason: "scope_count_mismatch" }
  }
  return { ok: true, reason: null }
}

export function mergeApprovedMetadata(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...existing }
  for (const field of V2_PATCH_FIELDS) {
    if (!(field in patch)) continue
    const value = patch[field]
    if (isEmpty(value)) continue
    merged[field] = cloneValue(value)
  }
  return merged
}

export function verifyPlanPreconditions(
  plan: ProductV2Plan,
  current: CurrentProductState | undefined
): { ok: boolean; reason: string | null } {
  if (!current) return { ok: false, reason: "product_not_found" }
  if (current.id !== plan.product_id) {
    return { ok: false, reason: "product_id_mismatch" }
  }
  if (current.metadata.sync_provider !== "aveda") {
    return { ok: false, reason: "sync_provider_mismatch" }
  }
  if (current.metadata.brand !== "Aveda") {
    return { ok: false, reason: "brand_mismatch" }
  }
  if (current.metadata.source_url !== plan.source_url) {
    return { ok: false, reason: "source_url_mismatch" }
  }
  if (current.metadata.external_id !== plan.external_id) {
    return { ok: false, reason: "external_id_mismatch" }
  }
  if (
    metadataFingerprint(current.metadata) !== plan.metadata_fingerprint_before
  ) {
    return { ok: false, reason: "metadata_fingerprint_mismatch" }
  }
  return { ok: true, reason: null }
}

export class AvedaMetadataV2CommitWriter {
  constructor(private readonly updateMetadata: MetadataUpdater) {}

  async execute(
    plans: ProductV2Plan[],
    currentProducts: Map<string, CurrentProductState>,
    guard: CommitGuard
  ): Promise<CommitReport> {
    if (!guard.commit_enabled || guard.dry_run) {
      throw new Error(
        "Metadata V2 commit kilitli. AVEDA_METADATA_V2_COMMIT=true ve AVEDA_METADATA_V2_DRY_RUN=false birlikte gerekli."
      )
    }

    const products: CommitProductResult[] = []
    for (const plan of plans) {
      products.push(
        await this.executeProduct(plan, currentProducts.get(plan.product_id))
      )
    }

    return buildCommitReport(products, guard)
  }

  private async executeProduct(
    plan: ProductV2Plan,
    current: CurrentProductState | undefined
  ): Promise<CommitProductResult> {
    const base = resultBase(plan, current)
    if (!isEligible(plan)) {
      return { ...base, status: "skipped", error: "plan_not_eligible" }
    }

    const precondition = verifyPlanPreconditions(plan, current)
    if (!precondition.ok || !current) {
      return {
        ...base,
        status: "stale_plan",
        error: precondition.reason,
      }
    }

    const merged = mergeApprovedMetadata(current.metadata, plan.approved_patch)
    const changed = changedFields(current.metadata, merged)
    const afterFingerprint = metadataFingerprint(merged)
    if (changed.length === 0) {
      return {
        ...base,
        identity_verified: true,
        metadata_fingerprint_after: afterFingerprint,
        status: "unchanged",
      }
    }

    try {
      await this.updateMetadata(plan.product_id, merged)
      return {
        ...base,
        identity_verified: true,
        metadata_fingerprint_after: afterFingerprint,
        fields_changed: changed,
        status: "updated",
      }
    } catch (error) {
      return {
        ...base,
        identity_verified: true,
        metadata_fingerprint_after: null,
        fields_changed: changed,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

function isEligible(plan: ProductV2Plan): boolean {
  return (
    plan.status === "ready_for_v2" &&
    plan.identity_match === "full" &&
    plan.identity_confidence === "high" &&
    plan.fields_conflicted.length === 0 &&
    plan.taxonomy_validation_errors.length === 0 &&
    plan.parser_errors.length === 0
  )
}

function resultBase(
  plan: ProductV2Plan,
  current: CurrentProductState | undefined
): CommitProductResult {
  const currentMetadata = current?.metadata ?? {}
  const fieldsPreserved = Object.keys(currentMetadata)
    .filter((field) => !(field in plan.approved_patch))
    .sort()

  return {
    product_id: plan.product_id,
    handle: current?.handle ?? plan.handle,
    identity_verified: false,
    metadata_fingerprint_before: metadataFingerprint(currentMetadata),
    metadata_fingerprint_after: null,
    proposed_patch: plan.approved_patch,
    fields_changed: [],
    fields_preserved: fieldsPreserved,
    metadata_version_before:
      typeof currentMetadata.metadata_version === "number"
        ? currentMetadata.metadata_version
        : null,
    metadata_version_after: plan.metadata_version_after_proposed,
    status: "skipped",
    error: null,
    price_untouched: true,
    images_untouched: true,
    variants_untouched: true,
  }
}

function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): string[] {
  return V2_PATCH_FIELDS.filter(
    (field) => !valuesEqual(before[field], after[field])
  )
}

function buildCommitReport(
  products: CommitProductResult[],
  guard: CommitGuard
): CommitReport {
  return {
    report_schema_version: 1,
    generatedAt: new Date().toISOString(),
    mode: "commit",
    commit_enabled: guard.commit_enabled,
    dry_run: guard.dry_run,
    totals: {
      processed: products.length,
      eligible: products.filter((p) => p.error !== "plan_not_eligible").length,
      updated: products.filter((p) => p.status === "updated").length,
      unchanged: products.filter((p) => p.status === "unchanged").length,
      skipped: products.filter((p) => p.status === "skipped").length,
      stale_plan: products.filter((p) => p.status === "stale_plan").length,
      failed: products.filter((p) => p.status === "failed").length,
      db_writes: products.filter((p) => p.status === "updated").length,
    },
    products,
  }
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === "string") return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return metadataFingerprint({ value: a }) === metadataFingerprint({ value: b })
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneValue)
  if (value !== null && typeof value === "object") {
    const cloned: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      cloned[key] = cloneValue(item)
    }
    return cloned
  }
  return value
}
