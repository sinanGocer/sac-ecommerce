import {
  FieldDiff,
  FieldStatus,
  IdentityConfidence,
  IdentityMatch,
  ProductV2Plan,
  ProductV2Status,
  TARGET_METADATA_VERSION,
  V2_PATCH_FIELDS,
} from "./metadata-v2.types"
import { metadataFingerprint } from "./metadata-v2-fingerprint"

/**
 * Saf (yan etkisiz) diff/identity/readiness mantığı.
 * DB, network, I/O YOK → birim test edilebilir, deterministik.
 */

export interface IdentityInput {
  source_url: string | null
  external_id: string | null
}

export interface DuplicateFlags {
  sourceUrl: boolean
  externalId: boolean
}

export interface ProductPlanInput {
  productId: string
  handle: string | null
  existingMetadata: Record<string, unknown>
  /** buildMetadata çıktısından patch alanlarına indirgenmiş canonical öneri. */
  proposedCanonical: Record<string, unknown>
  /** Ürünün saklı kimliği (source_url/external_id). */
  identity: IdentityInput
  duplicate: DuplicateFlags
  parserErrors: string[]
  missingSourceData: string[]
  sourceEvidence: string
}

// ---- yardımcılar ----

export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === "string") return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    const sa = [...a].map(String).sort()
    const sb = [...b].map(String).sort()
    return sa.every((v, i) => v === sb[i])
  }
  return a === b
}

// ---- kimlik ----

export function classifyIdentity(
  existing: IdentityInput,
  source: IdentityInput,
  duplicate: DuplicateFlags
): { match: IdentityMatch; confidence: IdentityConfidence } {
  if (duplicate.sourceUrl || duplicate.externalId) {
    return { match: "duplicate", confidence: "none" }
  }

  const urlBoth = !isEmpty(existing.source_url) && !isEmpty(source.source_url)
  const idBoth = !isEmpty(existing.external_id) && !isEmpty(source.external_id)
  const urlSame = urlBoth && existing.source_url === source.source_url
  const idSame = idBoth && existing.external_id === source.external_id

  // İki kimlik de var ve ikisi de FARKLI ürünü işaret ediyor → conflict
  if (urlBoth && idBoth && !urlSame && !idSame) {
    return { match: "conflict", confidence: "none" }
  }
  if (urlSame && idSame) return { match: "full", confidence: "high" }
  if (urlSame && !idSame) {
    return { match: "partial_source_url", confidence: "low" }
  }
  if (idSame && !urlSame) {
    return { match: "partial_external_id", confidence: "low" }
  }
  return { match: "none", confidence: "none" }
}

// ---- alan diff ----

function classifyField(before: unknown, after: unknown): FieldStatus | null {
  // Planner bu alan için öneri üretmedi (ör. buildMetadata kapsamı dışı)
  if (after === undefined) {
    return isEmpty(before) ? null : "preserved"
  }
  const afterEmpty = isEmpty(after)
  const beforeEmpty = isEmpty(before)

  if (afterEmpty && beforeEmpty) return null // raporlanmaz
  if (afterEmpty && !beforeEmpty) return "preserved" // null kaynakla silme yok
  if (!afterEmpty && beforeEmpty) return "added"
  if (valuesEqual(before, after)) return "unchanged"
  return "conflict" // ikisi de dolu ve farklı → otomatik overwrite YOK
}

// ---- plan üretimi ----

export function buildProductPlan(input: ProductPlanInput): ProductV2Plan {
  const { existingMetadata, proposedCanonical } = input

  const identity = classifyIdentity(
    input.identity,
    {
      source_url:
        (proposedCanonical.source_url as string | null | undefined) ?? null,
      external_id:
        (proposedCanonical.external_id as string | null | undefined) ?? null,
    },
    input.duplicate
  )

  // Taxonomy doğrulaması (döngüden ÖNCE — legacy normalization kararında kullanılır)
  const taxonomyErrors: string[] = []
  if (isEmpty(proposedCanonical.category_external_id)) {
    taxonomyErrors.push("category_external_id_unresolved")
  }
  if (isEmpty(proposedCanonical.category_path)) {
    taxonomyErrors.push("category_path_unresolved")
  }
  const taxonomyValid = taxonomyErrors.length === 0

  const versionBefore =
    typeof existingMetadata.metadata_version === "number"
      ? existingMetadata.metadata_version
      : null

  // V1 legacy kayıt: sürüm yok/1 + mevcut canonical kategori linki yok + mapping geçerli.
  // Bu durumda legacy category değeri ile canonical öneri farkı manuel CONFLICT değil,
  // tanınmış legacy NORMALIZED'dir. V2 kayıtlarda veya canonical kategori varsa conflict korunur.
  const existingHasCanonicalCategory =
    !isEmpty(existingMetadata["category_path"]) ||
    !isEmpty(existingMetadata["category_external_id"])
  const isV1Legacy = versionBefore === null || versionBefore === 1
  const legacyCategoryNormalizationSafe =
    isV1Legacy && !existingHasCanonicalCategory && taxonomyValid

  const CATEGORY_FAMILY = new Set([
    "category",
    "subcategory",
    "category_path",
    "category_external_id",
  ])

  const diffs: FieldDiff[] = []
  const buckets: Record<FieldStatus, string[]> = {
    unchanged: [],
    added: [],
    normalized: [],
    conflict: [],
    rejected: [],
    preserved: [],
    preserved_manual: [],
  }

  for (const field of V2_PATCH_FIELDS) {
    if (field === "metadata_version") continue // sürüm ayrıca ele alınır
    const before = existingMetadata[field]
    const after = proposedCanonical[field]
    let status = classifyField(before, after)
    if (status === null) continue
    let reason: string | undefined

    // Legacy sub_category varsa, canonical subcategory eklenmesi "normalized"
    if (
      field === "subcategory" &&
      status === "added" &&
      !isEmpty(existingMetadata["sub_category"])
    ) {
      status = "normalized"
      reason = "legacy_subcategory_normalization"
    }

    // V1 legacy kategori değeri farkı → manuel conflict değil, legacy normalization
    if (
      status === "conflict" &&
      CATEGORY_FAMILY.has(field) &&
      legacyCategoryNormalizationSafe
    ) {
      status = "normalized"
      reason = "legacy_v1_category_normalization"
    }

    buckets[status].push(field)
    diffs.push({
      field,
      status,
      before: before ?? null,
      after: after ?? null,
      reason,
    })
  }

  const hasConflict = buckets.conflict.length > 0
  const identityRejected =
    identity.match === "duplicate" || identity.match === "conflict"

  // V2 readiness
  const ready =
    !identityRejected &&
    identity.match === "full" &&
    taxonomyValid &&
    input.parserErrors.length === 0 &&
    !hasConflict

  let status: ProductV2Status
  if (identityRejected) status = "rejected"
  else if (ready) status = "ready_for_v2"
  else status = "needs_review"

  const versionAfter = ready ? TARGET_METADATA_VERSION : null
  const approvedPatch: Record<string, unknown> = {}
  if (ready) {
    approvedPatch.metadata_version = TARGET_METADATA_VERSION
    for (const diff of diffs) {
      if (
        (diff.status === "added" || diff.status === "normalized") &&
        !isEmpty(diff.after)
      ) {
        approvedPatch[diff.field] = diff.after
      }
    }
  }

  const categoryRelationChange =
    diffs.some(
      (d) =>
        d.field === "category_external_id" &&
        (d.status === "added" ||
          d.status === "normalized" ||
          d.status === "conflict")
    )

  return {
    product_id: input.productId,
    handle: input.handle,
    source_url: input.identity.source_url,
    external_id: input.identity.external_id,
    identity_match: identity.match,
    identity_confidence: identity.confidence,
    metadata_version_before: versionBefore,
    metadata_version_after_proposed: versionAfter,
    status,
    fields_unchanged: buckets.unchanged,
    fields_added: buckets.added,
    fields_normalized: buckets.normalized,
    fields_conflicted: buckets.conflict,
    fields_rejected: buckets.rejected,
    fields_preserved: [...buckets.preserved, ...buckets.preserved_manual],
    taxonomy_validation_errors: taxonomyErrors,
    parser_errors: input.parserErrors,
    missing_source_data: input.missingSourceData,
    source_evidence: input.sourceEvidence,
    category_relation_change_proposed: categoryRelationChange,
    price_untouched: true,
    images_untouched: true,
    variants_untouched: true,
    metadata_fingerprint_before: metadataFingerprint(existingMetadata),
    approved_patch: approvedPatch,
    diffs,
  }
}
