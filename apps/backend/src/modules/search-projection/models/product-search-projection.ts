import { model } from "@medusajs/framework/utils"

/**
 * product_search_projection — hafif arama/filtre/sıralama görünümü.
 *
 * PostgreSQL source of truth DEĞİLDİR; Medusa ürününden + metadata'dan türetilir.
 * Ağır alanlar (description/ingredients/usage/HTML) MODELE ALINMAZ.
 *
 * Notlar:
 * - `id` Medusa tarafından üretilen birincil anahtardır (prefix "psp").
 * - `product_id` benzersizdir → bir ürüne en fazla bir aktif projection (kural 1-3).
 * - `external_id` nullable, UNIQUE DEĞİL (bazı seed ürünlerinde yok — kural 4).
 * - dizi alanları PostgreSQL `text[]` olur (kural 5); GIN index'leri 2. migration'da.
 * - skorlar varsayılan 0 (kural 6); `average_rating` nullable (kural 7).
 * - `metadata_version`/`projection_schema_version` varsayılan 1 (kural 8).
 * - `price` para-güvenli `bigNumber` (numeric + raw_price jsonb); float yuvarlama yok (kural 9).
 * - `created_at`/`updated_at`/`deleted_at` Medusa tarafından otomatik eklenir
 *   (satır yaşam döngüsü). Ürün zaman damgaları için karar raporda ayrıca sunuldu.
 */
const ProductSearchProjection = model
  .define("product_search_projection", {
    id: model.id({ prefix: "psp" }).primaryKey(),
    product_id: model.text().unique(),
    external_id: model.text().nullable(),
    handle: model.text().nullable(),
    title: model.text().nullable(),
    brand: model.text().nullable(),
    category_ids: model.array(),
    category_path: model.text().nullable(),
    subcategory: model.text().nullable(),
    collection: model.text().nullable(),
    hair_type: model.array(),
    concerns: model.array(),
    benefits: model.array(),
    size_ml: model.number().nullable(),
    vegan: model.boolean().nullable(),
    color_safe: model.boolean().nullable(),
    professional_only: model.boolean().default(false),
    price: model.bigNumber().nullable(),
    currency: model.text().default("try"),
    in_stock: model.boolean().default(false),
    thumbnail: model.text().nullable(),
    average_rating: model.float().nullable(),
    review_count: model.number().default(0),
    weekly_sales_score: model.float().default(0),
    monthly_sales_score: model.float().default(0),
    all_time_sales_score: model.float().default(0),
    favorite_score: model.float().default(0),
    trending_score: model.float().default(0),
    // Ürünün gerçek tarihleri (sıralama/"Yeni Gelenler"); satır yaşam döngüsü
    // created_at/updated_at Medusa tarafından otomatik yönetilir.
    source_created_at: model.dateTime().nullable(),
    source_updated_at: model.dateTime().nullable(),
    metadata_version: model.number().default(1),
    projection_schema_version: model.number().default(1),
  })
  .indexes([
    { on: ["handle"] },
    { on: ["brand"] },
    { on: ["category_path"] },
    { on: ["price"] },
    { on: ["created_at"] },
    { on: ["updated_at"] },
    { on: ["source_created_at"] },
  ])

export default ProductSearchProjection
