/**
 * Aveda Metadata V2 Enrichment Planner — tipler.
 *
 * Planner YALNIZCA dry-run patch PLANI üretir; hiçbir DB write yapmaz,
 * hiçbir ürünü güncellemez. Fiyat/görsel/varyant/title/handle alanlarına dokunmaz.
 */

/** Bir metadata alanının diff sınıfı. */
export type FieldStatus =
  | "unchanged"
  | "added"
  | "normalized"
  | "conflict"
  | "rejected"
  | "preserved"
  | "preserved_manual"

export interface FieldDiff {
  field: string
  status: FieldStatus
  before: unknown
  after: unknown
  reason?: string
}

export type IdentityMatch =
  | "full"
  | "partial_source_url"
  | "partial_external_id"
  | "conflict"
  | "duplicate"
  | "none"

export type IdentityConfidence = "high" | "low" | "none"

export type ProductV2Status = "ready_for_v2" | "needs_review" | "rejected"

/** Tek ürün için planlama sonucu. */
export interface ProductV2Plan {
  product_id: string
  handle: string | null
  source_url: string | null
  external_id: string | null
  identity_match: IdentityMatch
  identity_confidence: IdentityConfidence
  metadata_version_before: number | null
  metadata_version_after_proposed: number | null
  status: ProductV2Status
  fields_unchanged: string[]
  fields_added: string[]
  fields_normalized: string[]
  fields_conflicted: string[]
  fields_rejected: string[]
  fields_preserved: string[]
  taxonomy_validation_errors: string[]
  parser_errors: string[]
  missing_source_data: string[]
  source_evidence: string
  category_relation_change_proposed: boolean
  price_untouched: true
  images_untouched: true
  variants_untouched: true
  diffs: FieldDiff[]
}

export interface V2ReportTotals {
  processed: number
  ready_for_v2: number
  needs_review: number
  rejected: number
  identity_conflicts: number
  taxonomy_errors: number
  parser_errors: number
  missing_source_data: number
  patches_proposed: number
  db_writes: 0
}

export interface V2Report {
  report_schema_version: number
  generatedAt: string
  mode: "dry-run"
  source_mode: string
  totals: V2ReportTotals
  products: ProductV2Plan[]
}

/**
 * Planner'ın sahibi olduğu (patch önerebileceği) sync-owned alanlar.
 * Bu listenin DIŞINDAKİ tüm metadata alanları korunur (preserved_manual).
 */
export const V2_PATCH_FIELDS = [
  "metadata_version",
  "sync_provider",
  "brand",
  "category",
  "subcategory",
  "category_path",
  "category_external_id",
  "hair_type",
  "concerns",
  "benefits",
  "size_ml",
  "vegan",
  "color_safe",
  "professional_only",
  "source_url",
  "external_id",
] as const

export type V2PatchField = (typeof V2_PATCH_FIELDS)[number]

export const V2_REPORT_SCHEMA_VERSION = 1
export const TARGET_METADATA_VERSION = 2
