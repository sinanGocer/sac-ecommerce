import {
  BuilderProductInput,
  BuildProjectionOptions,
  BuilderCategoryInput,
  NO_SOURCE_DEFAULTS,
  PROJECTION_SCHEMA_VERSION,
  SearchProjection,
} from "./search-projection.types"

const MAX_REASONABLE_SIZE_ML = 10_000

/**
 * Saf (yan etkisiz) projection builder.
 * Bir Medusa ürününü (decoupled girdi) hafif SearchProjection nesnesine dönüştürür.
 *
 * - I/O YOK, DB YOK, ağ YOK → birim test edilebilir, N+1 üretmez.
 * - Ağır alanlar (description/ingredients/usage) bilinçli olarak alınmaz.
 * - Kaynağı olmayan skor alanları uydurulmaz; NO_SOURCE_DEFAULTS kullanılır.
 */
export function buildSearchProjection(
  product: BuilderProductInput,
  options: BuildProjectionOptions = {}
): SearchProjection {
  const currency = (options.currency ?? "try").toLowerCase()
  const meta = product.metadata ?? {}

  return {
    product_id: product.id,
    external_id: getString(meta, "external_id"),
    handle: nullableString(product.handle),
    title: nullableString(product.title),

    brand: getString(meta, "brand"),
    category_ids: normalizeStringArray(product.category_ids),
    category_path:
      getString(meta, "category_path") ??
      categoryPathFromRelations(product.categories ?? []),
    subcategory: getString(meta, "subcategory") ?? getString(meta, "sub_category"),
    collection:
      getString(meta, "collection") ?? nullableString(product.collection_title),
    hair_type: getStringArray(meta, "hair_type"),
    concerns: getStringArray(meta, "concerns"),
    benefits: getStringArray(meta, "benefits"),
    size_ml: getPositiveInteger(meta, "size_ml") ?? parseVolumeToMl(meta.volume),
    vegan: getBoolean(meta, "vegan"),
    color_safe: getBoolean(meta, "color_safe"),
    // Kaynağı yoksa güvenli varsayılan: false (uydurma yok)
    professional_only: getBoolean(meta, "professional_only") ?? false,

    price: lowestPrice(product, currency),
    currency,
    in_stock: isInStock(product),

    thumbnail: nullableString(product.thumbnail),

    // KAYNAK YOK — açık varsayılanlar (Reviews/Sales/Favorites kurulunca beslenecek)
    average_rating: NO_SOURCE_DEFAULTS.average_rating,
    review_count: NO_SOURCE_DEFAULTS.review_count,
    weekly_sales_score: NO_SOURCE_DEFAULTS.weekly_sales_score,
    monthly_sales_score: NO_SOURCE_DEFAULTS.monthly_sales_score,
    all_time_sales_score: NO_SOURCE_DEFAULTS.all_time_sales_score,
    favorite_score: NO_SOURCE_DEFAULTS.favorite_score,
    trending_score: NO_SOURCE_DEFAULTS.trending_score,

    // created_at/updated_at PROJECTION satırına aittir (DB-managed) → builder set etmez.
    created_at: null,
    updated_at: null,
    // Ürünün gerçek tarihleri ayrı alanlarda.
    source_created_at: toIso(product.created_at),
    source_updated_at: toIso(product.updated_at),
    metadata_version: getNumber(meta, "metadata_version") ?? 1,
    projection_schema_version: PROJECTION_SCHEMA_VERSION,
  }
}

// ---- fiyat / stok ----

function lowestPrice(
  product: BuilderProductInput,
  currency: string
): number | null {
  let min: number | null = null
  for (const variant of product.variants) {
    for (const price of variant.prices) {
      if (price.currency_code.toLowerCase() !== currency) continue
      if (!Number.isFinite(price.amount)) continue
      if (min === null || price.amount < min) min = price.amount
    }
  }
  return min
}

function isInStock(product: BuilderProductInput): boolean {
  // Stok yönetimi kapalı varyant her zaman "stokta" sayılır;
  // açıksa inventory_quantity > 0 gerekir.
  return product.variants.some((v) => {
    if (v.manage_inventory === false) return true
    return (v.inventory_quantity ?? 0) > 0
  })
}

// ---- güvenli metadata okuyucular (no any) ----

function nullableString(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

function getString(meta: Record<string, unknown>, key: string): string | null {
  const v = meta[key]
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null
}

function getStringArray(
  meta: Record<string, unknown>,
  key: string
): string[] {
  return normalizeStringArray(meta[key])
}

function normalizeStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const item of v) {
    if (typeof item === "string") {
      const t = item.trim()
      if (t.length > 0) out.push(t)
    }
  }
  return out
}

function getPositiveInteger(
  meta: Record<string, unknown>,
  key: string
): number | null {
  return normalizeSizeMl(meta[key])
}

function getNumber(meta: Record<string, unknown>, key: string): number | null {
  const v = meta[key]
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim().length > 0) {
    const n = Number.parseFloat(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

function parseVolumeToMl(v: unknown): number | null {
  return normalizeSizeMl(v)
}

function normalizeSizeMl(v: unknown): number | null {
  if (typeof v === "number") return validSizeMl(v)
  if (typeof v !== "string") return null

  const raw = v.trim()
  if (raw.length === 0) return null

  const numericOnly = raw.match(/^\d+(?:[.,]\d+)?$/)
  if (numericOnly) {
    return validSizeMl(Number.parseFloat(raw.replace(",", ".")))
  }

  const ml = raw.match(/^(\d+(?:[.,]\d+)?)\s*ml$/i)
  if (ml) {
    return validSizeMl(Number.parseFloat(ml[1].replace(",", ".")))
  }

  const liter = raw.match(/^(\d+(?:[.,]\d+)?)\s*l$/i)
  if (liter) {
    return validSizeMl(Number.parseFloat(liter[1].replace(",", ".")) * 1000)
  }

  return null
}

function validSizeMl(n: number): number | null {
  if (!Number.isFinite(n) || n <= 0 || n > MAX_REASONABLE_SIZE_ML) return null
  if (!Number.isInteger(n)) return null
  return n
}

function categoryPathFromRelations(
  categories: BuilderCategoryInput[]
): string | null {
  const candidates = categories
    .map(categoryPathCandidate)
    .filter((v): v is string => v !== null)
  const unique = [...new Set(candidates)].sort((a, b) => a.localeCompare(b))

  return unique.length === 1 ? unique[0] : null
}

function categoryPathCandidate(category: BuilderCategoryInput): string | null {
  const externalPath = pathFromExternalId(category.external_id)
  if (externalPath) return externalPath

  return nullableString(category.handle) ?? nullableString(category.name)
}

function pathFromExternalId(v: string | null): string | null {
  const externalId = nullableString(v)
  if (!externalId) return null

  const prefix = "product-catalog:category:"
  if (externalId.startsWith(prefix)) {
    return nullableString(externalId.slice(prefix.length))
  }

  return externalId
}

function getBoolean(
  meta: Record<string, unknown>,
  key: string
): boolean | null {
  const v = meta[key]
  if (typeof v === "boolean") return v
  if (v === "true") return true
  if (v === "false") return false
  return null
}

function toIso(v: string | Date | null | undefined): string | null {
  if (!v) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString()
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
