import { CategoryMappingService } from "../services/category-mapping.service"
import { CurrencyCode, RawProduct } from "../types/product-sync.types"
import { buildProductPlan } from "./metadata-v2-diff"
import {
  ProductV2Plan,
  V2_REPORT_SCHEMA_VERSION,
  V2Report,
} from "./metadata-v2.types"

/**
 * Aveda Metadata V2 Enrichment Planner (dry-run).
 *
 * Tek sorumluluk: mevcut Aveda ürünlerini okuyup, mevcut Product Sync
 * canonical metadata üretimini (CategoryMappingService.buildMetadata) YENİDEN
 * KULLANARAK önerilen V2 patch planını çıkarmak. Hiçbir DB write yapmaz.
 *
 * Kaynak modu: OFFLINE re-normalization — canlı network fetch YOK. Ürünün saklı
 * kaynak alanları (source_category, source_subcategory, volume, title, description)
 * üzerinden RawProduct yeniden kurulur ve canonical metadata yeniden üretilir.
 * Deterministik: aynı girdi → aynı çıktı.
 */

interface ProductRow {
  id: string
  handle?: string | null
  title?: string | null
  description?: string | null
  metadata?: Record<string, unknown> | null
}

type QueryLike = {
  graph: (args: {
    entity: string
    fields: string[]
    pagination?: { skip: number; take: number }
  }) => Promise<{ data?: ProductRow[] }>
}

const PATCH_SOURCE_FIELDS = [
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
  "source_url",
  "external_id",
] as const

export class AvedaMetadataV2Planner {
  constructor(
    private readonly query: QueryLike,
    private readonly categories: CategoryMappingService = new CategoryMappingService()
  ) {}

  async plan(): Promise<V2Report> {
    const rows = await this.readAvedaProducts()

    // Duplicate identity tespiti (tek geçiş)
    const urlCounts = new Map<string, number>()
    const idCounts = new Map<string, number>()
    for (const row of rows) {
      const m = row.metadata ?? {}
      const url = str(m.source_url)
      const ext = str(m.external_id)
      if (url) urlCounts.set(url, (urlCounts.get(url) ?? 0) + 1)
      if (ext) idCounts.set(ext, (idCounts.get(ext) ?? 0) + 1)
    }

    const products: ProductV2Plan[] = []
    for (const row of rows) {
      products.push(this.planProduct(row, urlCounts, idCounts))
    }

    return this.buildReport(products)
  }

  private async readAvedaProducts(): Promise<ProductRow[]> {
    const { data } = await this.query.graph({
      entity: "product",
      fields: ["id", "handle", "title", "description", "metadata"],
    })
    const rows = data ?? []
    return rows.filter((r) => str(r.metadata?.sync_provider) === "aveda")
  }

  private planProduct(
    row: ProductRow,
    urlCounts: Map<string, number>,
    idCounts: Map<string, number>
  ): ProductV2Plan {
    const m = row.metadata ?? {}
    const sourceUrl = str(m.source_url)
    const externalId = str(m.external_id)
    const sourceCategory = str(m.source_category)
    const legacy = isLegacyMetadata(m)
    const categorySource =
      sourceCategory ?? (legacy ? str(m.category) : null)
    const preserveCanonicalV2 =
      metadataVersion(m) === 2 && sourceCategory === null

    const parserErrors: string[] = []
    const missingSourceData: string[] = []
    if (!sourceUrl) missingSourceData.push("source_url")
    if (!externalId) missingSourceData.push("external_id")
    if (!categorySource && !preserveCanonicalV2) {
      missingSourceData.push("source_category")
    }

    // Kaynak kanıtı (kısa token'lar; uzun dump yok)
    const evidence: string[] = []
    if (sourceCategory) evidence.push("stored_source_category")
    else if (legacy && str(m.category)) evidence.push("legacy_metadata_category")
    else if (preserveCanonicalV2) {
      evidence.push("preserved_canonical_v2_without_source_category")
    }
    if (str(m.source_subcategory)) evidence.push("stored_source_subcategory")
    else if (legacy && str(m.sub_category)) evidence.push("stored_sub_category")
    else if (legacy && str(m.subcategory)) evidence.push("stored_subcategory")
    const sourceEvidence =
      evidence.length > 0
        ? evidence.join(",")
        : "reconstructed_from_stored_metadata"

    const proposed = preserveCanonicalV2
      ? this.preserveCanonicalMetadata(m)
      : this.buildCanonicalProposal(row, legacy)
    // professional_only buildMetadata tarafından üretilmez → önerilmez (preserved)

    return buildProductPlan({
      productId: row.id,
      handle: row.handle ?? null,
      existingMetadata: m,
      proposedCanonical: proposed,
      identity: { source_url: sourceUrl, external_id: externalId },
      duplicate: {
        sourceUrl: sourceUrl ? (urlCounts.get(sourceUrl) ?? 0) > 1 : false,
        externalId: externalId ? (idCounts.get(externalId) ?? 0) > 1 : false,
      },
      parserErrors,
      missingSourceData,
      sourceEvidence,
    })
  }

  private buildCanonicalProposal(
    row: ProductRow,
    legacy: boolean
  ): Record<string, unknown> {
    const raw = this.reconstructRawProduct(row, legacy)
    const canonical = this.categories.buildMetadata(raw)
    const canonicalRecord = canonical as unknown as Record<string, unknown>
    const proposed: Record<string, unknown> = { sync_provider: "aveda" }
    for (const field of PATCH_SOURCE_FIELDS) {
      proposed[field] = canonicalRecord[field]
    }
    return proposed
  }

  private preserveCanonicalMetadata(
    metadata: Record<string, unknown>
  ): Record<string, unknown> {
    const proposed: Record<string, unknown> = { sync_provider: "aveda" }
    for (const field of PATCH_SOURCE_FIELDS) {
      proposed[field] = metadata[field]
    }
    return proposed
  }

  private reconstructRawProduct(row: ProductRow, legacy: boolean): RawProduct {
    const m = row.metadata ?? {}
    const currency: CurrencyCode = "try"
    return {
      sourceUrl: str(m.source_url) ?? "",
      externalId: str(m.external_id) ?? "",
      name: str(row.title) ?? "",
      brand: str(m.brand) ?? "Aveda",
      category:
        str(m.source_category) ?? (legacy ? str(m.category) : null),
      subCategory:
        str(m.source_subcategory) ??
        (legacy ? str(m.sub_category) ?? str(m.subcategory) : null),
      listPrice: null,
      currentPrice: null,
      salePrice: null,
      discountRate: null,
      currency,
      images: [],
      shortDescription: null,
      longDescription: str(row.description),
      usage: str(m.usage),
      ingredients: str(m.ingredients),
      volume: str(m.volume),
      variants: [],
      sku: str(m.sku),
      stockStatus: null,
      warnings: [],
    }
  }

  private buildReport(products: ProductV2Plan[]): V2Report {
    const totals = {
      processed: products.length,
      ready_for_v2: products.filter((p) => p.status === "ready_for_v2").length,
      needs_review: products.filter((p) => p.status === "needs_review").length,
      rejected: products.filter((p) => p.status === "rejected").length,
      identity_conflicts: products.filter(
        (p) => p.identity_match === "conflict"
      ).length,
      taxonomy_errors: products.filter(
        (p) => p.taxonomy_validation_errors.length > 0
      ).length,
      parser_errors: products.filter((p) => p.parser_errors.length > 0).length,
      missing_source_data: products.filter(
        (p) => p.missing_source_data.length > 0
      ).length,
      patches_proposed: products.filter(
        (p) =>
          p.fields_added.length > 0 ||
          p.fields_normalized.length > 0 ||
          p.metadata_version_after_proposed !== null
      ).length,
      db_writes: 0 as const,
    }

    return {
      report_schema_version: V2_REPORT_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      mode: "dry-run",
      source_mode: "offline_reconstruction",
      totals,
      products,
    }
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function metadataVersion(metadata: Record<string, unknown>): number | null {
  return typeof metadata.metadata_version === "number"
    ? metadata.metadata_version
    : null
}

export function isLegacyMetadata(
  metadata: Record<string, unknown>
): boolean {
  const version = metadataVersion(metadata)
  return (
    (version === null || version === 1) &&
    str(metadata.category_path) === null &&
    str(metadata.category_external_id) === null
  )
}
