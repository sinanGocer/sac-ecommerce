/**
 * Product Sync Engine v1 — ortak tipler.
 * Strict TypeScript. `any` kullanılmaz.
 */

/** Basit logger arayüzü (Medusa logger ya da console ile uyumlu). */
export interface SyncLogger {
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
}

/** Para birimi (v1: yalnızca TRY). */
export type CurrencyCode = "try"

/** Brand altında çözümlenmiş nested kategori yolu. */
export interface ProductCategoryPath {
  brand: string
  path: string[]
  leaf: string
  externalId: string
}

export interface ProductSyncMetadata {
  brand: string
  category: string | null
  subcategory: string | null
  hair_type: string[]
  concerns: string[]
  benefits: string[]
  size_ml: number | null
  vegan: boolean | null
  color_safe: boolean | null
  ingredients: string | null
  usage: string | null
  is_gift_set: boolean
  size_type: "travel" | "full_size" | null
  limited_edition: boolean
  source_url: string
  external_id: string
  original_category_path: string | null
  product_type: string | null
  usage_category: string | null
  hair_type_primary: string | null
  hair_concern: string | null
  collection: string | null
  category_path: string | null
  category_external_id: string | null
}

/** Sağlayıcıdan gelen ham varyant. */
export interface RawVariant {
  title: string
  sku: string | null
  volume: string | null
  /** Normal liste fiyatı (varsa). */
  listPrice: number | null
  /** İndirimli fiyat (varsa). */
  salePrice: number | null
}

/** Sağlayıcıdan gelen ham ürün verisi (henüz Medusa formatına dönüştürülmemiş). */
export interface RawProduct {
  /** Kaynak ürün URL'i — idempotency için birincil anahtar. */
  sourceUrl: string
  /** Kaynak sistemdeki kararlı kimlik (ör. URL'deki ürün id'si). */
  externalId: string
  name: string
  brand: string
  category: string | null
  subCategory: string | null
  /** Normal liste fiyatı. */
  listPrice: number | null
  /** Sitede görünen güncel fiyat. */
  currentPrice: number | null
  /** İndirimli fiyat (varsa). */
  salePrice: number | null
  /** İndirim oranı (yüzde, 0-100). */
  discountRate: number | null
  currency: CurrencyCode
  images: string[]
  shortDescription: string | null
  longDescription: string | null
  usage: string | null
  ingredients: string | null
  volume: string | null
  variants: RawVariant[]
  sku: string | null
  /** "in_stock" | "out_of_stock" | null (bilinmiyor). */
  stockStatus: "in_stock" | "out_of_stock" | null
  /** Çıkarım sırasında oluşan uyarılar (eksik alanlar vb.). */
  warnings: string[]
  /**
   * Ayrıştırma/doğrulama hataları (geçersiz başlık, saç-dışı ürün vb.).
   * Dolu ise ürün create edilmez; review'a yönlendirilir.
   */
  parserErrors?: string[]
  /** Ad provenance: hangi kaynaktan çözüldü (json_ld_product/og_title/...). */
  titleSource?: string
  /** Başlık güvenilir bir kaynaktan mı doğrulandı? */
  titleVerified?: boolean
  /** Fiyat provenance: json-ld/json-key/data-attr/tl-text/null. */
  priceSource?: string | null
  /** Fiyat ürün bağlamından mı doğrulandı? */
  priceVerified?: boolean
}

/** Fiyatlandırma politikası kararı. */
export interface PricingDecision {
  /** Medusa'ya yazılacak fiyat (politika gereği normal liste fiyatı). */
  medusaPrice: number | null
  discountDetected: boolean
  salePrice: number | null
  discountRate: number | null
  /** %10'dan büyük indirim, eksik fiyat veya marj ihlali → true. */
  reviewRequired: boolean
  /** Minimum kâr marjı kuralı sonucu (maliyet yoksa null). */
  marginOk: boolean | null
  reasons: string[]
}

/** Idempotent senkron eylemi. */
export type SyncAction = "create" | "update" | "skip" | "review" | "filtered"

/** Medusa'ya yazıma hazır taslak (v1'de yalnızca raporlanır, yazılmaz). */
export interface MedusaProductDraft {
  externalId: string
  sourceUrl: string
  title: string
  handle: string
  description: string | null
  status: "draft" | "proposed"
  categoryName: string | null
  categoryPath: ProductCategoryPath | null
  images: string[]
  currency: CurrencyCode
  /** Politika sonrası fiyat (null ise review). */
  price: number | null
  metadata: Record<string, string | number | boolean | string[] | null>
  variants: Array<{
    title: string
    sku: string | null
    price: number | null
  }>
}

/** Tek bir ürün için senkron rapor satırı. */
export interface SyncReportEntry {
  sourceUrl: string
  externalId: string
  name: string
  action: SyncAction
  pricing: PricingDecision
  draft: MedusaProductDraft | null
  /** commit modunda Medusa'ya yazıldıysa oluşan/güncellenen ürün id'si. */
  committed: boolean
  committedId: string | null
  warnings: string[]
  errors: string[]
  /** Geriye uyumlu provenance/güvenilirlik alanları (opsiyonel). */
  titleSource?: string
  titleVerified?: boolean
  priceSource?: string | null
  priceVerified?: boolean
  parserErrors?: string[]
  reviewReasons?: string[]
  /** Allowlist/seçim sonucu (pilot import). */
  selected?: boolean
  selectionReason?: string
}

/** Tüm senkron koşusunun raporu. */
export interface SyncReport {
  provider: string
  startedAt: string
  finishedAt: string
  dryRun: boolean
  limit: number | null
  total: number
  summary: {
    create: number
    update: number
    skip: number
    review: number
    errors: number
    committed: number
    /** Pilot/allowlist alanları (geriye uyumlu). */
    discovered: number
    processed: number
    selected: number
    filtered_not_selected: number
    skipped_existing_create_only: number
    failed: number
    db_writes: number
    dry_run: boolean
    commit_enabled: boolean
    create_only: boolean
    requested_external_ids: number
    matched_external_ids: number
    missing_requested_external_ids: string[]
    /** Batch create (atomicity) alanları. */
    create_ready: number
    batch_size: number
    workflow_calls: number
  }
  results: SyncReportEntry[]
}

/** Fiyat değişikliği kaydı (price history / onay akışı). */
export interface PriceChangeRecord {
  id: string
  provider: string
  externalId: string
  sourceUrl: string
  name: string
  field: "price" | "sale_price"
  oldValue: number | null
  newValue: number | null
  discountRate: number | null
  reviewRequired: boolean
  status: "pending" | "approved" | "rejected"
  detectedAt: string
  resolvedAt: string | null
}

/** Senkron sağlayıcı arayüzü. Yeni kaynaklar bu arayüzü uygular. */
export interface SyncProvider {
  readonly name: string
  /** Senkronlanacak ürün URL'lerini keşfeder (sorumlu: sitemap vb.). */
  fetchProductUrls: (limit: number | null) => Promise<string[]>
  /** Tek bir ürünü çeker ve ham veriye dönüştürür. */
  fetchProduct: (url: string) => Promise<RawProduct>
}

/** Senkron çalıştırma seçenekleri. */
export interface SyncRunOptions {
  dryRun: boolean
  limit: number | null
  /** v1'de daima false — Medusa yazımı 2. adımda açılacak. */
  commit: boolean
  /**
   * Pilot import allowlist'i: yalnız bu external_id'ler işlenir/commit edilir.
   * null/boş → allowlist devre dışı (mevcut davranış korunur).
   */
  onlyExternalIds?: string[] | null
  /** true → yalnız create commit edilir; update/existing atlanır. */
  createOnly?: boolean
}
