import { PricingDecision, RawProduct } from "../types/product-sync.types"

/**
 * Fiyatlandırma Politikası
 * ------------------------
 * - Medusa fiyatı = normal liste fiyatı (indirimli fiyat OTOMATİK yayına alınmaz).
 * - İndirimli fiyat yalnızca metadata'ya kaydedilir.
 * - discount_detected = indirimli fiyat < liste fiyatı.
 * - %10'dan büyük indirimde review_required = true.
 * - Minimum kâr marjı kuralı için yapı hazır (maliyet verisi geldiğinde devreye girer).
 * - Fiyat eksikse review_required = true (yanlış fiyatla yayını engeller).
 */
export interface PricingPolicyConfig {
  /** Bu oranın üstündeki indirimler manuel onay ister (yüzde). */
  reviewDiscountThreshold: number
  /** Minimum kabul edilebilir kâr marjı (oran, 0-1). Maliyet yoksa uygulanmaz. */
  minMargin: number
}

export const DEFAULT_PRICING_CONFIG: PricingPolicyConfig = {
  reviewDiscountThreshold: 10,
  minMargin: 0.2,
}

export class PricingPolicyService {
  private readonly config: PricingPolicyConfig

  constructor(config: PricingPolicyConfig = DEFAULT_PRICING_CONFIG) {
    this.config = config
  }

  /**
   * Ham ürün için fiyat kararını üretir.
   * @param cost Opsiyonel ürün maliyeti (marj kuralı için). v1'de genelde null.
   */
  decide(product: RawProduct, cost: number | null = null): PricingDecision {
    const reasons: string[] = []

    const listPrice = product.listPrice
    const salePrice = product.salePrice

    // İndirim tespiti
    const discountDetected =
      typeof listPrice === "number" &&
      typeof salePrice === "number" &&
      salePrice < listPrice

    // İndirim oranı (sağlayıcıdan gelmediyse hesapla)
    let discountRate: number | null = product.discountRate
    if (discountRate === null && discountDetected && listPrice && salePrice) {
      discountRate = Math.round(((listPrice - salePrice) / listPrice) * 100)
    }

    // Politika: Medusa fiyatı = normal liste fiyatı
    const medusaPrice = listPrice

    let reviewRequired = false

    if (medusaPrice === null) {
      reviewRequired = true
      reasons.push("Liste fiyatı bulunamadı; fiyat manuel onay gerektirir.")
    }

    if (discountDetected) {
      reasons.push(
        `İndirim tespit edildi (%${discountRate ?? "?"}). İndirimli fiyat yayına alınmaz, metadata'ya kaydedilir.`
      )
      if (
        discountRate !== null &&
        discountRate > this.config.reviewDiscountThreshold
      ) {
        reviewRequired = true
        reasons.push(
          `İndirim %${this.config.reviewDiscountThreshold} eşiğini aştı; manuel onay gerekir.`
        )
      }
    }

    // Minimum kâr marjı kuralı (maliyet varsa)
    let marginOk: boolean | null = null
    if (typeof medusaPrice === "number" && typeof cost === "number" && medusaPrice > 0) {
      const margin = (medusaPrice - cost) / medusaPrice
      marginOk = margin >= this.config.minMargin
      if (!marginOk) {
        reviewRequired = true
        reasons.push(
          `Kâr marjı (%${Math.round(margin * 100)}) minimum %${Math.round(
            this.config.minMargin * 100
          )} altında; manuel onay gerekir.`
        )
      }
    }

    if (reasons.length === 0) {
      reasons.push("Fiyat politikası temiz; otomatik yayına uygun.")
    }

    return {
      medusaPrice,
      discountDetected,
      salePrice: discountDetected ? salePrice : null,
      discountRate: discountDetected ? discountRate : null,
      reviewRequired,
      marginOk,
      reasons,
    }
  }
}
