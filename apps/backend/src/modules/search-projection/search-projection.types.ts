/**
 * Search Projection — tipler ve sabitler
 * =======================================
 * PostgreSQL **source of truth** olarak kalır. Bu projection yalnızca
 * ARAMA, FİLTRELEME ve SIRALAMA için optimize edilmiş HAFİF bir görünümdür.
 *
 * - Ağır metin alanları (description, ingredients, usage) BİLİNÇLİ olarak
 *   projection'a alınmaz (HEAVY_FIELDS_EXCLUDED).
 * - Alan adları snake_case; Typesense, PostgreSQL adapter ve Redis cache
 *   katmanıyla uyumlu olacak şekilde seçildi.
 * - Bu dosya yalnızca TİP/SÖZLEŞME tanımıdır; canlı bir DB modeli (model.define)
 *   veya migration İÇERMEZ. Tablo/migration sonraki onaylı adımda eklenecek.
 */

/** Projection şema sürümü — şema değişince artırılır (cache/yeniden indeks için). */
export const PROJECTION_SCHEMA_VERSION = 1

/** Projection'a ASLA taşınmayacak ağır alanlar (performans). */
export const HEAVY_FIELDS_EXCLUDED = [
  "description",
  "ingredients",
  "usage",
] as const

/**
 * Kaynağı HENÜZ kurulmamış alanlar.
 * Reviews Ecosystem, Sales/Ranking ve Favorites sistemleri kurulunca beslenecek.
 * v1'de uydurulmaz; açık varsayılanla işaretlenir.
 */
export const NO_SOURCE_DEFAULTS = {
  average_rating: null,
  review_count: 0,
  weekly_sales_score: 0,
  monthly_sales_score: 0,
  all_time_sales_score: 0,
  favorite_score: 0,
  trending_score: 0,
} as const

/** Hangi projection alanının kaynağı nereden gelir (dokümantasyon). */
export const FIELD_SOURCE_MAP: Record<string, string> = {
  product_id: "medusa.product.id",
  external_id: "metadata.external_id",
  handle: "medusa.product.handle",
  title: "medusa.product.title",
  brand: "metadata.brand",
  category_ids: "medusa.product.categories[].id",
  category_path:
    "metadata.category_path | medusa.product.categories[] (safe single relation fallback)",
  subcategory: "metadata.subcategory | metadata.sub_category",
  collection: "metadata.collection | medusa.product.collection.title",
  hair_type: "metadata.hair_type",
  concerns: "metadata.concerns",
  benefits: "metadata.benefits",
  size_ml: "metadata.size_ml | metadata.volume (safe parser fallback)",
  vegan: "metadata.vegan",
  color_safe: "metadata.color_safe",
  professional_only: "metadata.professional_only (yoksa false)",
  price: "medusa.variant.prices[currency].amount (en düşük)",
  currency: "build option (varsayılan try)",
  in_stock: "medusa.variant.manage_inventory/inventory_quantity",
  thumbnail: "medusa.product.thumbnail",
  created_at: "PROJECTION satır yaşam döngüsü (DB-managed; builder set etmez)",
  updated_at: "PROJECTION satır yaşam döngüsü (DB-managed; builder set etmez)",
  source_created_at: "medusa.product.created_at",
  source_updated_at: "medusa.product.updated_at",
  metadata_version: "metadata.metadata_version (yoksa 1)",
  // KAYNAK YOK (NO_SOURCE_DEFAULTS):
  average_rating: "KAYNAK YOK — Reviews Ecosystem",
  review_count: "KAYNAK YOK — Reviews Ecosystem",
  weekly_sales_score: "KAYNAK YOK — Sales/Ranking",
  monthly_sales_score: "KAYNAK YOK — Sales/Ranking",
  all_time_sales_score: "KAYNAK YOK — Sales/Ranking",
  favorite_score: "KAYNAK YOK — Favorites",
  trending_score: "KAYNAK YOK — Trending",
}

/** Arama/filtre/sıralama için hafif projection kaydı. */
export interface SearchProjection {
  // Kimlik
  product_id: string
  external_id: string | null
  handle: string | null
  title: string | null

  // Sınıflandırma / filtre
  brand: string | null
  category_ids: string[]
  category_path: string | null
  subcategory: string | null
  collection: string | null
  hair_type: string[]
  concerns: string[]
  benefits: string[]
  size_ml: number | null
  vegan: boolean | null
  color_safe: boolean | null
  professional_only: boolean

  // Fiyat / stok
  price: number | null
  currency: string
  in_stock: boolean

  // Sunum
  thumbnail: string | null

  // Sıralama skorları — KAYNAK YOK, varsayılanla (bkz. NO_SOURCE_DEFAULTS)
  average_rating: number | null
  review_count: number
  weekly_sales_score: number
  monthly_sales_score: number
  all_time_sales_score: number
  favorite_score: number
  trending_score: number

  // Meta
  // created_at/updated_at: PROJECTION KAYDININ kendi yaşam döngüsü (DB-managed).
  // Builder bunları ürün tarihleriyle EZMEZ; dry-run'da null'dır.
  created_at: string | null
  updated_at: string | null
  // Ürünün gerçek tarihleri (sıralama/"Yeni Gelenler" için).
  source_created_at: string | null
  source_updated_at: string | null
  metadata_version: number
  projection_schema_version: number
}

/** Builder girdisi — Medusa'dan DECOUPLE edilmiş hafif şekil (test edilebilir). */
export interface BuilderVariantInput {
  prices: Array<{ amount: number; currency_code: string }>
  inventory_quantity: number | null
  manage_inventory: boolean | null
}

export interface BuilderCategoryInput {
  id: string
  name: string | null
  handle: string | null
  external_id: string | null
}

export interface BuilderProductInput {
  id: string
  handle: string | null
  title: string | null
  thumbnail: string | null
  created_at: string | Date | null
  updated_at: string | Date | null
  category_ids: string[]
  categories?: BuilderCategoryInput[]
  collection_title: string | null
  metadata: Record<string, unknown> | null
  variants: BuilderVariantInput[]
}

export interface BuildProjectionOptions {
  /** Hedef para birimi (varsayılan "try"). */
  currency?: string
}
