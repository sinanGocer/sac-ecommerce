import {
  MedusaProductDraft,
  PricingDecision,
  RawProduct,
} from "../types/product-sync.types"

/**
 * Ham ürünü + fiyat kararını Medusa'ya yazıma hazır taslağa dönüştürür.
 * - Idempotency anahtarları (external_id, source_url) metadata'ya yazılır.
 * - İndirimli fiyat yalnızca metadata'da tutulur (yayına alınmaz).
 * - review gereken ürün "proposed" statüsünde kalır.
 */
export class MedusaProductTransformer {
  transform(
    product: RawProduct,
    pricing: PricingDecision
  ): MedusaProductDraft {
    const handle = this.slugify(
      this.lastSlug(product.sourceUrl) ?? product.name
    )

    const description =
      product.longDescription ?? product.shortDescription ?? null

    const status: MedusaProductDraft["status"] = pricing.reviewRequired
      ? "proposed"
      : "draft"

    const metadata: MedusaProductDraft["metadata"] = {
      sync_provider: "aveda",
      external_id: product.externalId,
      source_url: product.sourceUrl,
      brand: product.brand,
      category: product.category,
      sub_category: product.subCategory,
      volume: product.volume,
      sku: product.sku,
      ingredients: product.ingredients,
      usage: product.usage,
      stock_status: product.stockStatus,
      // Fiyat politikası kayıtları
      list_price: pricing.medusaPrice,
      discount_detected: pricing.discountDetected,
      sale_price: pricing.salePrice,
      discount_rate: pricing.discountRate,
      review_required: pricing.reviewRequired,
      margin_ok: pricing.marginOk,
    }

    const variants = product.variants.map((v) => ({
      title: v.title,
      sku: v.sku,
      // Politika: yayına liste fiyatı; varyant fiyatı yoksa ürün fiyatına düş
      price: v.listPrice ?? pricing.medusaPrice,
    }))

    return {
      externalId: product.externalId,
      sourceUrl: product.sourceUrl,
      title: product.name,
      handle,
      description,
      status,
      categoryName: product.category,
      images: product.images,
      currency: product.currency,
      price: pricing.medusaPrice,
      metadata,
      variants:
        variants.length > 0
          ? variants
          : [{ title: "Standart", sku: product.sku, price: pricing.medusaPrice }],
    }
  }

  private lastSlug(url: string): string | null {
    try {
      const parts = new URL(url).pathname.split("/").filter(Boolean)
      return parts.length > 0 ? parts[parts.length - 1] : null
    } catch {
      return null
    }
  }

  private slugify(input: string): string {
    const map: Record<string, string> = {
      ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u",
      Ç: "c", Ğ: "g", İ: "i", Ö: "o", Ş: "s", Ü: "u",
    }
    return input
      .replace(/[çğıöşüÇĞİÖŞÜ]/g, (ch) => map[ch] ?? ch)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120)
  }
}
