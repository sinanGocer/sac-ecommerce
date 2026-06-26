/**
 * Catalog Product Quarantine — politika + tipler (SAF, IO yok).
 *
 * Bu araç YALNIZ tek bir allowlist ürünü için çalışır ve hiçbir koşulda
 * delete/cart-line silme üretmez. Hedef: hatalı (parse hatası) katalog kaydını
 * storefront/Store API/Search yüzeyinden güvenli biçimde gizlemek.
 *
 * Politika sürümü değişirse fingerprint değişir → eski commit confirm token'ları
 * otomatik geçersiz olur.
 */

/** Merkezi politika sürümü. Cleanup kuralı değişirse arttır. */
export const QUARANTINE_POLICY_VERSION = 1

/**
 * Hedef ürün durumu. Medusa Store API yalnız `published` ürünleri döndürür;
 * `draft` storefront + Store API + ürün listelemesinden gizler ve geri
 * alınabilir (reversible) güvenli durumdur. `rejected` "review red" semantiği
 * taşıdığından tercih edilmez.
 */
export const TARGET_PRODUCT_STATUS = "draft" as const

/** Hedef sales channel ilişkileri (hatalı ürün → tüm kanallardan çıkar). */
export const TARGET_SALES_CHANNEL_IDS: readonly string[] = []

/** TEK izinli ürün (hardcoded allowlist; başka ürün asla işlenmez). */
export const ALLOWLISTED_PRODUCT_ID = "prod_01KVQHSEDTH4K5049T9PV9WPZM"

/** Provenance: kaynak URL host'u bu domende olmalı. */
export const EXPECTED_SOURCE_HOST = "aveda.com.tr"

/** Provenance: kaynak URL (alfanümerik katlanmış) bu token'ı içermeli. */
export const EXPECTED_SOURCE_URL_TOKEN = "colorrenewal"

/**
 * Beklenen kimlik. Plan üretilmeden önce mevcut DB verisi bununla karşılaştırılır;
 * herhangi biri uyuşmazsa QUARANTINE_STALE_PLAN (fail-closed). Sadece title'a
 * güvenilmez — external_id + SKU + brand + status + metadata_version + source_url
 * birlikte doğrulanır.
 */
export interface ExpectedIdentity {
  product_id: string
  external_id: string
  sku: string
  brand: string
  status: string
  metadata_version: number
  title: string
  source_host: string
  source_url_token: string
}

export const EXPECTED_IDENTITY: ExpectedIdentity = {
  product_id: ALLOWLISTED_PRODUCT_ID,
  external_id: "102748",
  sku: "VC9001",
  brand: "Aveda",
  status: "published",
  metadata_version: 2,
  title: "KİŞİSEL VERİLERİN KORUNMASI VE İŞLENMESİNE İLİŞKİN AYDINLATMA METNİ",
  source_host: EXPECTED_SOURCE_HOST,
  source_url_token: EXPECTED_SOURCE_URL_TOKEN,
}

// ── Snapshot & referans tipleri (script tarafından read-only doldurulur) ──────

export interface SalesChannelRef {
  id: string
  name: string | null
}

export interface ProductSnapshot {
  product_id: string
  title: string | null
  status: string
  /** external_id, brand, metadata_version, source_url, sync_provider içerir. */
  metadata: Record<string, unknown>
  variant_skus: string[]
  sales_channels: SalesChannelRef[]
  /** Search Projection satırı (yoksa null). */
  projection: { id: string; product_id: string } | null
}

export interface ReferenceCounts {
  active_cart_lines: number
  completed_cart_lines: number
  order_lines: number
  order_items: number
  inventory_relations: number
  variant_count: number
  price_count: number
  image_count: number
  sales_channel_relations: number
  category_relations: number
  projection_count: number
}

export type QuarantineActionType =
  | "PRODUCT_UNPUBLISH"
  | "SALES_CHANNEL_DETACH"
  | "PROJECTION_REMOVE_OR_HIDE"

export type QuarantineActionStatus = "planned" | "no_op"

export interface PlannedAction {
  action: QuarantineActionType
  status: QuarantineActionStatus
  executed: boolean
  db_writes: number
  detail: Record<string, unknown>
}

export type QuarantineDecision =
  | "QUARANTINE_DRY_RUN_READY"
  | "QUARANTINE_PLAN_BLOCKED"
  | "QUARANTINE_STALE_PLAN"
  | "QUARANTINE_COMMITTED"
  | "QUARANTINE_IDEMPOTENT_NOOP"
