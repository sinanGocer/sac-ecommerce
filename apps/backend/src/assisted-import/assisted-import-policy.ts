/**
 * User-Assisted Aveda Import — politika + tipler (SAF, IO yok).
 *
 * Kullanıcının tarayıcıdan sağladığı ürün URL listesi (.txt), CSV (.csv) veya
 * kaydedilmiş HTML sayfalarından gerçek Aveda ürünlerini içe aktarmak için
 * dry-run-first plan üretir. Erişim engeli AŞILMAZ; veri yalnız kullanıcının
 * sağladığı dosyalardan gelir. VARSAYILAN: dry-run, DB mutation 0.
 */

export const ASSISTED_IMPORT_POLICY_VERSION = 1

export type ImportInputFormat = "txt" | "csv" | "html"

/** Asla yeniden yayınlanmayacak / içe aktarılmayacak korunan ürünler. */
export const PROTECTED_PRODUCT_IDS: readonly string[] = [
  // KVKK parse-error ürünü (draft kalmalı)
  "prod_01KVQHSEDTH4K5049T9PV9WPZM",
  // 5 salon demo ürünü (cleanup ile draft yapıldı; geri yayınlanmaz)
  "prod_01KVQ6B1ZA5BSQFQEEK1PWE3H7",
  "prod_01KVQ6B1ZASCV42QZF4QFGTH0T",
  "prod_01KVQ6B1ZAX6XJFD7TQPTYBFHF",
  "prod_01KVQ6B1ZAN5CYKY08TPHTVDTF",
  "prod_01KVQ6B1ZA3HBYRM14NEVCK3YK",
]

/** Korunan ürünlerin handle'ları (URL/slug bazlı koruma için). */
export const PROTECTED_HANDLES: readonly string[] = [
  "color-renewaltm-sac-rengi-canlandran-ve-parlaklk-katan-sac-bakm-maskeleri",
  "sac-boyasi-7-0-kumral",
  "oksidan-6-20vol-1000ml",
  "onarici-keratin-sampuani-1000ml",
  "derin-bakim-sac-maskesi-500ml",
  "isi-koruyucu-sprey-200ml",
]

// ── Giriş kayıtları ───────────────────────────────────────────────────────────

export interface ImportInputRecord {
  source_format: ImportInputFormat
  url: string | null
  title: string | null
  price: number | null
  sku: string | null
  ean: string | null
  /** Kaydedilmiş HTML içeriği (html formatında doldurulur). */
  html: string | null
  /** Enriched kaynaklarda (kategori JSON) doğrudan gelen görseller/hacim. */
  images?: string[] | null
  volume?: string | null
  category?: string | null
  classification?: string | null
  source_file?: string | null
  /** Girişteki ham satır/dosya referansı (audit). */
  ref: string
}

// ── URL doğrulama ─────────────────────────────────────────────────────────────

export interface UrlValidationResult {
  ok: boolean
  external_id: string | null
  canonical_url: string | null
  reason: string | null
}

// ── Çıkarılmış ürün ───────────────────────────────────────────────────────────

export interface ExtractedProduct {
  external_id: string | null
  canonical_url: string | null
  title: string | null
  description: string | null
  images: string[]
  price_try: number | null
  sku: string | null
  ean: string | null
  volume: string | null
  category: string | null
  /** Eksik zorunlu alanlar (title/price/image/volume). */
  missing_fields: string[]
  ref: string
}

// ── Mevcut ürün (read-only snapshot) ──────────────────────────────────────────

export interface ExistingProductRef {
  product_id: string
  external_id: string | null
  handle: string | null
  normalized_title: string
  volume: string | null
}

// ── Karşılaştırma / plan ──────────────────────────────────────────────────────

export type ImportItemCategory =
  | "existing"
  | "new"
  | "update"
  | "duplicate"
  | "quarantine"
  | "missing_data"
  | "protected_skip"
  | "rejected_url"

export interface PlannedImportItem {
  ref: string
  category: ImportItemCategory
  external_id: string | null
  canonical_url: string | null
  title: string | null
  matched_product_id: string | null
  reasons: string[]
  images: string[]
  price_try: number | null
  sku: string | null
  ean: string | null
  volume: string | null
  source_category: string | null
  /** Dry-run: her zaman 0. */
  db_writes: 0
}

export type AssistedImportDecision =
  | "ASSISTED_IMPORT_DRY_RUN_READY"
  | "ASSISTED_IMPORT_EMPTY_INPUT"
  | "ASSISTED_IMPORT_BLOCKED"
  | "ASSISTED_IMPORT_COMMIT_READY"
  | "IDEMPOTENT_NOOP"
