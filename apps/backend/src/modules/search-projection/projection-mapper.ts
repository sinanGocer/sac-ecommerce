import { BuilderProductInput } from "./search-projection.types"

/**
 * Medusa ürün satırını (query.graph) → builder girdisine çeviren saf yardımcı.
 * Hem backfill hem de (ileride) subscriber AYNI dönüşümü kullanır → kod tekrarı yok.
 *
 * Ağır alanlar (description/ingredients/usage) bilinçli olarak ÇEKİLMEZ.
 */

/** query.graph "product" için çekilecek hafif alanlar (N+1 yok: tek sorguda nested). */
export const PRODUCT_GRAPH_FIELDS = [
  "id",
  "handle",
  "title",
  "thumbnail",
  "created_at",
  "updated_at",
  "metadata",
  "collection.title",
  "categories.id",
  "categories.name",
  "categories.handle",
  "categories.external_id",
  "variants.id",
  "variants.prices.amount",
  "variants.prices.currency_code",
  "variants.manage_inventory",
  "variants.allow_backorder",
] as const

interface RawPrice {
  amount?: number
  currency_code?: string
}
interface RawVariant {
  id?: string | null
  prices?: RawPrice[]
  manage_inventory?: boolean | null
  allow_backorder?: boolean | null
}
export interface ProductGraphRow {
  id: string
  handle?: string | null
  title?: string | null
  thumbnail?: string | null
  created_at?: string | null
  updated_at?: string | null
  metadata?: Record<string, unknown> | null
  collection?: { title?: string | null } | null
  categories?: Array<{
    id: string
    name?: string | null
    handle?: string | null
    external_id?: string | null
  }> | null
  variants?: RawVariant[] | null
}

export type VariantAvailabilityMap = Map<string, boolean>

export function toBuilderInput(
  row: ProductGraphRow,
  availabilityByVariantId: VariantAvailabilityMap = new Map()
): BuilderProductInput {
  const variants = (row.variants ?? []).map((v) => ({
    prices: (v.prices ?? [])
      .filter(
        (p): p is { amount: number; currency_code: string } =>
          typeof p.amount === "number" && typeof p.currency_code === "string"
      )
      .map((p) => ({ amount: p.amount, currency_code: p.currency_code })),
    manage_inventory: v.manage_inventory ?? null,
    allow_backorder: v.allow_backorder ?? null,
    is_available:
      typeof v.id === "string"
        ? availabilityByVariantId.get(v.id) ?? null
        : null,
  }))

  return {
    id: row.id,
    handle: row.handle ?? null,
    title: row.title ?? null,
    thumbnail: row.thumbnail ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    category_ids: (row.categories ?? []).map((c) => c.id),
    categories: (row.categories ?? []).map((c) => ({
      id: c.id,
      name: c.name ?? null,
      handle: c.handle ?? null,
      external_id: c.external_id ?? null,
    })),
    collection_title: row.collection?.title ?? null,
    metadata: row.metadata ?? null,
    variants,
  }
}
