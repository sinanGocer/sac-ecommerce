/**
 * Search Projection — TABLO & INDEX PLANI (yalnızca dokümantasyon)
 * ================================================================
 * Bu dosya CANLI bir model (model.define) veya migration DEĞİLDİR.
 * Tablo ve migration, ayrı ve onaylı bir adımda eklenecektir.
 * Burada yalnızca planlanan kolon tipleri, index'ler ve cache anahtarı
 * stratejisi tip-güvenli sabitler olarak belgelenir.
 */

export interface ProjectionColumnPlan {
  column: string
  pgType: string
  index: string | null
  note?: string
}

/** Planlanan PostgreSQL tablosu: product_search_projection */
export const PROJECTION_TABLE = "product_search_projection"

export const PROJECTION_COLUMN_PLAN: ProjectionColumnPlan[] = [
  { column: "product_id", pgType: "text", index: "PRIMARY KEY" },
  { column: "external_id", pgType: "text", index: "btree", note: "kaynak idempotency" },
  { column: "handle", pgType: "text", index: "unique" },
  { column: "title", pgType: "text", index: null },
  { column: "brand", pgType: "text", index: "btree", note: "multi-brand filtre" },
  { column: "category_ids", pgType: "text[]", index: "GIN" },
  { column: "category_path", pgType: "text", index: "btree" },
  { column: "subcategory", pgType: "text", index: "btree" },
  { column: "collection", pgType: "text", index: "btree" },
  { column: "hair_type", pgType: "text[]", index: "GIN" },
  { column: "concerns", pgType: "text[]", index: "GIN" },
  { column: "benefits", pgType: "text[]", index: "GIN" },
  { column: "size_ml", pgType: "integer", index: "btree" },
  { column: "vegan", pgType: "boolean", index: null },
  { column: "color_safe", pgType: "boolean", index: null },
  { column: "professional_only", pgType: "boolean", index: null },
  { column: "price", pgType: "numeric", index: "btree", note: "fiyat sıralama/aralık" },
  { column: "currency", pgType: "text", index: null },
  { column: "in_stock", pgType: "boolean", index: "partial(in_stock=true)" },
  { column: "thumbnail", pgType: "text", index: null },
  { column: "average_rating", pgType: "numeric", index: "btree", note: "KAYNAK YOK (Reviews)" },
  { column: "review_count", pgType: "integer", index: null, note: "KAYNAK YOK (Reviews)" },
  { column: "weekly_sales_score", pgType: "numeric", index: "btree", note: "KAYNAK YOK (Sales)" },
  { column: "monthly_sales_score", pgType: "numeric", index: "btree", note: "KAYNAK YOK (Sales)" },
  { column: "all_time_sales_score", pgType: "numeric", index: "btree", note: "KAYNAK YOK (Sales)" },
  { column: "favorite_score", pgType: "numeric", index: "btree", note: "KAYNAK YOK (Favorites)" },
  { column: "trending_score", pgType: "numeric", index: "btree", note: "KAYNAK YOK (Trending)" },
  { column: "created_at", pgType: "timestamptz", index: "btree", note: "PROJECTION satır yaşam döngüsü (DB-managed)" },
  { column: "updated_at", pgType: "timestamptz", index: "btree", note: "PROJECTION satır yaşam döngüsü (DB-managed)" },
  { column: "source_created_at", pgType: "timestamptz", index: "btree", note: "ürün tarihi — 'Yeni Gelenler' sıralaması" },
  { column: "source_updated_at", pgType: "timestamptz", index: null, note: "ürün güncelleme tarihi" },
  { column: "metadata_version", pgType: "integer", index: null },
  { column: "projection_schema_version", pgType: "integer", index: null },
]

/**
 * Cursor pagination için kararlı kompozit anahtar.
 * Sıralama alanı + product_id (tiebreaker) → deterministik, offset'siz sayfalama.
 */
export const CURSOR_KEYS: Record<string, string[]> = {
  newest: ["source_created_at", "product_id"],
  price_asc: ["price", "product_id"],
  price_desc: ["price", "product_id"],
  best_sellers: ["all_time_sales_score", "product_id"],
  top_rated: ["average_rating", "product_id"],
  trending: ["trending_score", "product_id"],
}

/**
 * Redis uyumlu cache anahtarı stratejisi (yalnız plan; bağlantı kurulmaz).
 * Örn: search:v1:brand=aveda:cur=try:f=<filtersHash>:s=newest:c=<cursor>
 */
export const CACHE_KEY_PREFIX = "search"

export function buildCacheKeyTemplate(): string {
  return `${CACHE_KEY_PREFIX}:v{projection_schema_version}:brand={brandScope}:cur={currency}:f={filtersHash}:s={sort}:c={cursor}`
}
