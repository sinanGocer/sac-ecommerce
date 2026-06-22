/**
 * Görsel Servisi
 * --------------
 * - Göreli URL'leri mutlak hale getirir.
 * - Yalnızca ANA ürünün görsellerini tutar (ilgili ürünlerin ve badge'lerin
 *   görselleri elenir).
 * - Yinelenen görselleri (farklı boyut varyantları) tekilleştirir.
 *
 * Aveda görsel adı deseni: av_sku_<SKU>_<materialCode>_<WxH>_<idx>.jpg
 * veya av_prod_<code>_<WxH>_<idx>.jpg
 *
 * Not: v1'de görsel indirme/yükleme yapılmaz; yalnızca URL'ler normalize edilir.
 */
export interface MainImageResult {
  images: string[]
  sku: string | null
  code: string | null
}

export class ImageService {
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "")
  }

  toAbsolute(url: string): string {
    if (/^https?:\/\//i.test(url)) return url
    return `${this.baseUrl}/${url.replace(/^\//, "")}`
  }

  /**
   * Ana ürünün görsellerini, SKU/kod eşleşmesine göre filtreleyerek çıkarır.
   * @param ogImageUrl og:image (genelde ana ürün görseli) — ana SKU/kod tespiti için.
   */
  extractMainProductImages(
    html: string,
    ogImageUrl: string | null
  ): MainImageResult {
    const regex = /\/media\/images\/products\/[^"')\s]+?\.(?:jpg|jpeg|png|webp)/gi
    const all = (html.match(regex) ?? [])
      .filter((u) => !/\/badges\//i.test(u)) // badge görsellerini ele
      .map((u) => this.toAbsolute(u))

    // Ana SKU/kod tespiti: önce og:image, sonra ilk ürün görseli
    const idFromOg = ogImageUrl ? this.parseSkuCode(ogImageUrl) : null
    const idFromFirst = all.length ? this.parseSkuCode(all[0]) : null
    const main = idFromOg ?? idFromFirst

    let candidates = all
    if (main?.sku) {
      candidates = all.filter((u) => u.includes(`av_sku_${main.sku}_`))
    } else if (main?.code) {
      candidates = all.filter((u) => u.includes(`av_prod_${main.code}_`))
    } else {
      // Kimlik yoksa kirliliği önlemek için yalnızca ilk görseli al
      candidates = all.slice(0, 1)
    }

    // og:image ürün görseliyse en başa al
    if (
      ogImageUrl &&
      /av_sku_|av_prod_/.test(ogImageUrl) &&
      !/\/badges\//i.test(ogImageUrl)
    ) {
      const ogAbs = this.toAbsolute(ogImageUrl)
      if (!candidates.includes(ogAbs)) candidates.unshift(ogAbs)
    }

    return {
      images: this.dedupe(candidates),
      sku: main?.sku ?? null,
      code: main?.code ?? null,
    }
  }

  private parseSkuCode(url: string): { sku: string | null; code: string | null } | null {
    const skuMatch = url.match(/av_sku_([A-Za-z0-9]+)_(\d+)_/)
    if (skuMatch) return { sku: skuMatch[1], code: skuMatch[2] }
    const prodMatch = url.match(/av_prod_(\d+)_/)
    if (prodMatch) return { sku: null, code: prodMatch[1] }
    return null
  }

  /** Boyut bağımsız tekilleştirme (av_sku_X_Y_330x548_0 ↔ _355x600_0). */
  private dedupe(urls: string[]): string[] {
    const seen = new Set<string>()
    const out: string[] = []
    for (const u of urls) {
      const file = (u.split("/").pop() ?? u).replace(/_\d+x\d+/i, "")
      if (seen.has(file)) continue
      seen.add(file)
      out.push(u)
    }
    return out
  }
}
