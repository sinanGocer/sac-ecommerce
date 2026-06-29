/**
 * Competitive Pricing Intelligence — politika + tipler (SAF, IO yok).
 *
 * VARSAYILAN: dry-run (DB fiyat mutation = 0). Bu modül yalnız ÖNERİ üretir;
 * gerçek fiyat yazımı ayrı bir env confirmation ile (bu aşamada çalıştırılmaz)
 * yapılır. Tüm hesaplar deterministik ve test edilebilir.
 */

export const PRICING_POLICY_VERSION = 1

/** Otomasyon modu. Yalnız `commit` gerçek yazıma izin verir (bu fazda kullanılmaz). */
export type PriceAutomationMode = "dry-run" | "commit"

export function resolveAutomationMode(
  raw: string | undefined | null
): PriceAutomationMode {
  return raw === "commit" ? "commit" : "dry-run"
}

// ── Eşleştirme (matching) ─────────────────────────────────────────────────────

/** Eşleşme önceliği (yüksekten düşüğe). */
export type MatchMethod =
  | "ean_gtin"
  | "sku_mpn"
  | "brand_name_volume"
  | "fuzzy"
  | "none"

export type MatchConfidence = "high" | "medium" | "low" | "rejected"

/** Hangi yöntem hangi güveni üretir (tek kaynak). */
export const MATCH_METHOD_CONFIDENCE: Record<MatchMethod, MatchConfidence> = {
  ean_gtin: "high",
  sku_mpn: "high",
  brand_name_volume: "medium",
  fuzzy: "low",
  none: "rejected",
}

/** Öneri için kabul edilen minimum güven (low fuzzy varsayılan olarak DIŞLANIR). */
export const ACCEPTED_MATCH_CONFIDENCES: readonly MatchConfidence[] = [
  "high",
  "medium",
]

// ── Rakip teklifi ─────────────────────────────────────────────────────────────

export interface CompetitorOffer {
  store: string
  /** Rakip ürün fiyatı (TRY, KDV dahil). */
  product_price: number
  /** Kargo ücreti (TRY). Bilinmiyorsa null. */
  shipping: number | null
  /** Toplam teslim fiyatı (ürün + kargo). null ise türetilir. */
  total_delivered?: number | null
  in_stock: boolean
  url: string
  /** ISO tarih — tarama zamanı (stale kontrolü için). */
  crawled_at: string
  match_method: MatchMethod
  /** Hacim/varyant eşleşmesi doğrulandı mı (yanlış hacim reddi için). */
  volume_match: boolean
}

export function offerTotal(offer: CompetitorOffer): number {
  if (typeof offer.total_delivered === "number") return offer.total_delivered
  return offer.product_price + (offer.shipping ?? 0)
}

// ── Güvenli fiyat girdileri ───────────────────────────────────────────────────

export interface SafePriceInputs {
  /** Ürün maliyeti (KDV hariç, TRY). */
  unit_cost: number
  /** KDV oranı (örn 0.20). */
  vat_rate: number
  /** Ödeme komisyonu oranı (brüt satış üzerinden, örn 0.025). */
  payment_commission_rate: number
  /** Mağazanın üstlendiği kargo katkısı (TRY). */
  shipping_contribution: number
  /** Platform/işletme sabit maliyeti (TRY). */
  platform_cost: number
  /** Minimum kâr oranı (maliyet üzerinden, örn 0.10). */
  min_profit_rate: number
  /** Minimum mutlak kâr (TRY). max(rate*cost, abs) alınır. */
  min_profit_abs: number
}

// ── Öneri kuralı yapılandırması ───────────────────────────────────────────────

export interface PriceRuleConfig {
  /** Sabit altına kırma (TRY). undercut_ratio verilmezse bu kullanılır. */
  undercut_abs: number
  /** Oransal altına kırma (örn 0.01 = %1). Verilirse abs yerine kullanılır. */
  undercut_ratio: number | null
  /** Güvenilir öneri için gereken minimum kabul edilen rakip teklifi sayısı. */
  min_reliable_offers: number
  /**
   * Anomali tabanı: medyanın bu oranından daha ucuz teklifler "anormal" sayılır
   * ve dışlanır (tek ucuz teklif fiyatı düşürmesin). Örn 0.4 → medyanın %40
   * altındaki teklifler atılır.
   */
  anomaly_below_median_ratio: number
  /** Günlük maksimum değişim oranı (örn 0.15 = %15). */
  max_daily_change_ratio: number
  /** Son değişimden bu kadar saat geçmeden yeni değişim önerilmez. */
  cooldown_hours: number
  /** Rakip verisi bu saatten eskiyse öneri bloke (stale). */
  stale_competitor_hours: number
}

export const DEFAULT_PRICE_RULE_CONFIG: PriceRuleConfig = {
  undercut_abs: 1,
  undercut_ratio: null,
  min_reliable_offers: 2,
  anomaly_below_median_ratio: 0.4,
  max_daily_change_ratio: 0.15,
  cooldown_hours: 24,
  stale_competitor_hours: 48,
}

// ── Karar tipleri ─────────────────────────────────────────────────────────────

export type PriceDecision =
  | "RECOMMEND_CHANGE"
  | "NO_CHANGE"
  | "HOLD_COOLDOWN"
  | "BLOCKED_STALE_DATA"
  | "BLOCKED_NO_RELIABLE_OFFERS"
  | "BLOCKED_BELOW_FLOOR"
  | "BLOCKED_MISSING_INPUTS"

export type PricingBatchDecision =
  | "PRICING_DRY_RUN_READY"
  | "PRICING_NO_COMPETITOR_SOURCE"
  | "PRICING_BLOCKED"
