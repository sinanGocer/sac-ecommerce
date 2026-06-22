import {
  CurrencyCode,
  RawProduct,
  RawVariant,
  SyncLogger,
  SyncProvider,
} from "../types/product-sync.types"
import { ImageService } from "../services/image.service"

export interface AvedaProviderOptions {
  baseUrl: string
  sitemapUrl: string
  userAgent: string
  /** İstekler arası bekleme (ms) — siteyi yormamak için. */
  requestDelayMs: number
  /** Tek istek zaman aşımı (ms). */
  timeoutMs: number
  /** Ürün URL'i keşfi için gezilecek maksimum listeleme sayfası. */
  maxListingPages: number
}

export const DEFAULT_AVEDA_OPTIONS: AvedaProviderOptions = {
  baseUrl: "https://www.aveda.com.tr",
  sitemapUrl: "https://www.aveda.com.tr/sitemap.xml",
  userAgent:
    "SinanKocerHairStore-ProductSync/1.0 (+https://www.aveda.com.tr; respectful crawler)",
  requestDelayMs: 1200,
  timeoutMs: 20000,
  maxListingPages: 40,
}

/** Ürün içeren kategori/listeleme kökleri (TR + EN). */
const LISTING_ROOTS = new Set<string>([
  "hair-care",
  "sac-bakimi",
  "styling",
  "sac-sekillendirme",
  "body",
  "vucut-bakim",
  "skin-care",
  "cilt-bakimi",
  "makeup",
  "men",
  "hediye",
  "gifts",
])

/** İçerik (ürün olmayan) kökler — keşiften hariç tutulur. */
const CONTENT_ROOTS = new Set<string>([
  "living-aveda",
  "icerik-listesi",
  "customer-service",
  "review",
  "pure-privilege",
])

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Aveda Türkiye (Drupal) sağlayıcısı.
 *
 * KEŞİF: Sitemap ürün DETAY URL'i içermez; yalnızca kategori/listeleme sayfaları içerir.
 * Bu yüzden: sitemap → listeleme sayfaları → her sayfadan /product/ linklerini topla.
 *
 * Ürün detay URL deseni: /product/{master}/{sku}/{kategori}/.../{slug}[?size=...][#/shade/...]
 *
 * robots.txt: /product, /sitemap.xml ve kategori sayfaları taramaya açıktır;
 * /cart /checkout /search'e dokunulmaz.
 */
export class AvedaProvider implements SyncProvider {
  readonly name = "aveda"
  private readonly options: AvedaProviderOptions
  private readonly logger: SyncLogger
  private readonly images: ImageService

  constructor(
    logger: SyncLogger,
    options: AvedaProviderOptions = DEFAULT_AVEDA_OPTIONS
  ) {
    this.logger = logger
    this.options = options
    this.images = new ImageService(options.baseUrl)
  }

  async fetchProductUrls(limit: number | null): Promise<string[]> {
    // 1) Sitemap
    this.logger.info(`[aveda] Sitemap okunuyor: ${this.options.sitemapUrl}`)
    const xml = await this.httpGet(this.options.sitemapUrl)
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(
      (m) => m[1]
    )
    this.logger.info(`[aveda] Sitemap'te toplam ${locs.length} URL bulundu.`)

    // 2) Sitemap içinde doğrudan ürün detay URL'i var mı? (genelde yok)
    const direct = this.canonicalizeMany(this.extractProductLinks(locs.join("\n")))
    this.logger.info(
      `[aveda] Sitemap'te doğrudan ürün detay URL'i: ${direct.length}`
    )

    // 3) Listeleme sayfası adayları
    const listingPages = locs.filter((u) => this.isListingPage(u))
    this.logger.info(
      `[aveda] Kategori/listeleme sayfası adayı: ${listingPages.length}`
    )

    // 4) Listeleme sayfalarını gez, /product/ linklerini topla
    const found = new Set<string>(direct)
    let pagesCrawled = 0

    for (const page of listingPages) {
      if (limit && found.size >= limit) break
      if (pagesCrawled >= this.options.maxListingPages) break

      try {
        await sleep(this.options.requestDelayMs)
        const html = await this.httpGet(page)
        const links = this.canonicalizeMany(this.extractProductLinks(html))
        let added = 0
        for (const l of links) {
          if (!found.has(l)) {
            found.add(l)
            added++
          }
        }
        pagesCrawled++
        this.logger.info(
          `[aveda] Listeleme [${pagesCrawled}] ${page} → ${links.length} link (${added} yeni). Toplam: ${found.size}`
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.warn(`[aveda] Listeleme atlandı (${page}): ${msg}`)
      }
    }

    const all = [...found]
    const result = limit && limit > 0 ? all.slice(0, limit) : all

    // 6/7) Debug: ilk 20 URL ve toplam eşleşme
    this.logger.info(
      `[aveda] Toplam benzersiz ürün URL'i: ${all.length} | döndürülen: ${result.length}`
    )
    this.logger.info("[aveda] İlk 20 ürün URL'i:")
    all.slice(0, 20).forEach((u, i) => this.logger.info(`   ${i + 1}. ${u}`))

    if (result.length === 0) {
      this.logger.warn(
        "[aveda] Hiç ürün URL'i bulunamadı. Listeleme yapısı değişmiş olabilir; selektörleri gözden geçirin."
      )
    }

    return result
  }

  async fetchProduct(url: string): Promise<RawProduct> {
    await sleep(this.options.requestDelayMs)
    this.logger.info(`[aveda] Ürün çekiliyor: ${url}`)

    const html = await this.httpGet(url)
    const meta = this.parseMetaTags(html)
    const warnings: string[] = []

    const { category, subCategory, urlId, slug } = this.parseUrlParts(url)

    // Ad: og:title genelde doğru; "Homepage"/boş ise h1, sonra slug'tan türet
    const name = this.resolveName(meta.get("og:title") ?? null, html, slug)

    const shortDescription = meta.get("og:description") ?? null

    // Görseller: yalnızca ANA ürün (badge ve ilgili ürünler elenir)
    const ogImage = meta.get("og:image") ?? null
    const imageResult = this.images.extractMainProductImages(html, ogImage)
    const images = imageResult.images
    if (images.length === 0) warnings.push("Ürün görseli bulunamadı.")

    // SKU: ana görselden; yoksa sayfadaki ilk av_sku
    const fallback = this.extractSku(html)
    const sku = imageResult.sku ?? fallback.sku
    const externalCode = imageResult.code ?? fallback.externalCode
    const externalId = urlId ?? externalCode ?? slug ?? url

    const volume =
      this.extractVolume(name) ?? this.extractVolume(shortDescription ?? "")

    // Fiyat: çok stratejili çıkarım (raw HTML script'leri dahil)
    const priceResult = this.extractPrice(html)
    const listPrice = priceResult.listPrice
    const salePrice = priceResult.salePrice
    if (listPrice === null) {
      warnings.push(
        "Fiyat bulunamadı (JSON-LD / JSON price / data-price / TL metni denendi). review gerekecek."
      )
    } else {
      this.logger.info(
        `[aveda] Fiyat bulundu (${priceResult.source}): list=${listPrice} sale=${salePrice ?? "-"}`
      )
    }
    if (!shortDescription) warnings.push("Kısa açıklama bulunamadı.")

    const discountRate =
      listPrice !== null && salePrice !== null && salePrice < listPrice
        ? Math.round(((listPrice - salePrice) / listPrice) * 100)
        : null

    const variant: RawVariant = {
      title: volume ?? "Standart",
      sku,
      volume,
      listPrice,
      salePrice,
    }

    const currency: CurrencyCode = "try"

    return {
      sourceUrl: url,
      externalId,
      name,
      brand: "Aveda",
      category,
      subCategory,
      listPrice,
      currentPrice: salePrice ?? listPrice,
      salePrice,
      discountRate,
      currency,
      images,
      shortDescription,
      longDescription: null,
      usage: null,
      ingredients: null,
      volume,
      variants: [variant],
      sku,
      stockStatus: null,
      warnings,
    }
  }

  // ---- ad çıkarımı ----

  private resolveName(
    ogTitle: string | null,
    html: string,
    slug: string | null
  ): string {
    const candidates = [
      ogTitle ? this.cleanTitle(ogTitle) : null,
      this.extractH1(html),
      slug ? this.slugToTitle(slug) : null,
    ]
    for (const c of candidates) {
      if (c && !this.isGenericName(c)) return c
    }
    return slug ? this.slugToTitle(slug) : "Bilinmeyen Ürün"
  }

  private isGenericName(name: string): boolean {
    const n = name.trim().toLowerCase()
    return n.length === 0 || n === "homepage" || n === "aveda"
  }

  private extractH1(html: string): string | null {
    const m = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
    if (!m) return null
    const text = this.decodeEntities(m[1].replace(/<[^>]+>/g, "").trim())
    return text.length > 0 ? text : null
  }

  private slugToTitle(slug: string): string {
    return slug
      .split("-")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  }

  // ---- fiyat çıkarımı (çok stratejili) ----

  private extractPrice(html: string): {
    listPrice: number | null
    salePrice: number | null
    source: string | null
  } {
    // 1) JSON-LD (application/ld+json) — Product/Offer
    const ld = this.priceFromJsonLd(html)
    if (ld.listPrice !== null) return { ...ld, source: "json-ld" }

    // 2) JSON anahtarları (dataLayer / commerce script'leri)
    const jsonKeys: Array<[RegExp, "list" | "sale"]> = [
      [/"(?:list_?price|regular_?price|original_?price)"\s*:\s*"?([\d.,]+)"?/i, "list"],
      [/"(?:sale_?price|final_?price|special_?price)"\s*:\s*"?([\d.,]+)"?/i, "sale"],
      [/"price"\s*:\s*"?([\d.,]+)"?/i, "list"],
      [/"unit_?price"\s*:\s*"?([\d.,]+)"?/i, "list"],
    ]
    let jl: number | null = null
    let js: number | null = null
    for (const [re, kind] of jsonKeys) {
      const m = html.match(re)
      if (!m) continue
      const val = this.parsePriceNumber(m[1])
      if (val === null) continue
      if (kind === "list" && jl === null) jl = val
      if (kind === "sale" && js === null) js = val
    }
    if (jl !== null || js !== null) {
      return {
        listPrice: jl ?? js,
        salePrice: jl !== null && js !== null && js < jl ? js : null,
        source: "json-key",
      }
    }

    // 3) data-* öznitelikleri
    const dataAttr = html.match(/data-(?:product-)?price\s*=\s*"([\d.,]+)"/i)
    if (dataAttr) {
      const val = this.parsePriceNumber(dataAttr[1])
      if (val !== null) return { listPrice: val, salePrice: null, source: "data-attr" }
    }

    // 4) TL / ₺ metni
    const tl =
      html.match(/(?:₺|TL|TRY)\s*([\d.]+(?:,\d{2})?)/i) ??
      html.match(/([\d.]+,\d{2})\s*(?:₺|TL|TRY)/i)
    if (tl) {
      const val = this.parsePriceNumber(tl[1])
      if (val !== null) return { listPrice: val, salePrice: null, source: "tl-text" }
    }

    return { listPrice: null, salePrice: null, source: null }
  }

  private priceFromJsonLd(html: string): {
    listPrice: number | null
    salePrice: number | null
  } {
    const blocks = [
      ...html.matchAll(
        /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
      ),
    ]
    for (const b of blocks) {
      let parsed: unknown
      try {
        parsed = JSON.parse(b[1].trim())
      } catch {
        continue
      }
      const offer = this.findOffer(parsed)
      if (offer && offer.price !== null) {
        return { listPrice: offer.price, salePrice: null }
      }
    }
    return { listPrice: null, salePrice: null }
  }

  /** JSON-LD ağacında ilk fiyatlı offer'ı bulur (tip güvenli). */
  private findOffer(node: unknown): { price: number | null } | null {
    if (Array.isArray(node)) {
      for (const item of node) {
        const r = this.findOffer(item)
        if (r) return r
      }
      return null
    }
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>
      const priceRaw = obj.price ?? obj.lowPrice
      if (typeof priceRaw === "string" || typeof priceRaw === "number") {
        const price = this.parsePriceNumber(String(priceRaw))
        if (price !== null) return { price }
      }
      for (const key of Object.keys(obj)) {
        const r = this.findOffer(obj[key])
        if (r) return r
      }
    }
    return null
  }

  /** "1.234,56" / "1234.56" / "1234,56" → 1234.56 */
  private parsePriceNumber(raw: string): number | null {
    let s = raw.trim()
    if (s.length === 0) return null
    const hasDot = s.includes(".")
    const hasComma = s.includes(",")
    if (hasDot && hasComma) {
      // Nokta binlik, virgül ondalık (TR)
      s = s.replace(/\./g, "").replace(",", ".")
    } else if (hasComma) {
      s = s.replace(",", ".")
    }
    const n = Number.parseFloat(s)
    return Number.isFinite(n) && n > 0 ? n : null
  }

  // ---- keşif yardımcıları ----

  private isListingPage(url: string): boolean {
    try {
      const parts = new URL(url).pathname.split("/").filter(Boolean)
      if (parts.length < 2) return false
      const root = parts[0].toLowerCase()
      if (CONTENT_ROOTS.has(root)) return false
      return LISTING_ROOTS.has(root)
    } catch {
      return false
    }
  }

  /** Bir metin/HTML içinden tüm /product/{id}/{id}/... yollarını çıkarır. */
  private extractProductLinks(text: string): string[] {
    const regex = /\/product\/\d+\/\d+\/[^\s"'<>)\]]+/gi
    return text.match(regex) ?? []
  }

  /** Ürün URL'lerini mutlaklaştırır, ?query ve #hash kırpar, tekilleştirir. */
  private canonicalizeMany(paths: string[]): string[] {
    const out = new Set<string>()
    for (const p of paths) {
      const noFragment = p.split("#")[0].split("?")[0]
      const abs = /^https?:\/\//i.test(noFragment)
        ? noFragment
        : `${this.options.baseUrl}${noFragment.startsWith("/") ? "" : "/"}${noFragment}`
      out.add(abs)
    }
    return [...out]
  }

  // ---- HTTP + ayrıştırma yardımcıları ----

  private async httpGet(url: string): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs)
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": this.options.userAgent,
          Accept: "text/html,application/xhtml+xml,application/xml",
          "Accept-Language": "tr-TR,tr;q=0.9",
        },
        signal: controller.signal,
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`)
      }
      return await res.text()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`İstek başarısız (${url}): ${message}`)
    } finally {
      clearTimeout(timer)
    }
  }

  private parseMetaTags(html: string): Map<string, string> {
    const map = new Map<string, string>()
    const tags = html.match(/<meta\b[^>]*>/gi) ?? []
    for (const tag of tags) {
      const keyMatch =
        tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1] ?? null
      const contentMatch =
        tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1] ?? null
      if (keyMatch && contentMatch !== null) {
        map.set(keyMatch.toLowerCase(), this.decodeEntities(contentMatch))
      }
    }
    return map
  }

  private extractTitle(html: string): string | null {
    const m = html.match(/<title\b[^>]*>([^<]*)<\/title>/i)
    return m ? this.decodeEntities(m[1].trim()) : null
  }

  private cleanTitle(title: string): string {
    return title.replace(/\s*\|\s*Aveda\s*$/i, "").trim()
  }

  private extractSku(html: string): {
    sku: string | null
    externalCode: string | null
  } {
    const m = html.match(/av_sku_([A-Za-z0-9]+)_(\d+)_/)
    if (!m) return { sku: null, externalCode: null }
    return { sku: m[1], externalCode: m[2] }
  }

  private parseUrlParts(url: string): {
    category: string | null
    subCategory: string | null
    urlId: string | null
    slug: string | null
  } {
    try {
      const path = new URL(url).pathname
      const parts = path.split("/").filter(Boolean)
      const productIdx = parts.indexOf("product")
      if (productIdx === -1) {
        return { category: null, subCategory: null, urlId: null, slug: null }
      }
      const ids = parts.slice(productIdx + 1, productIdx + 3)
      const urlId = ids[1] ?? ids[0] ?? null
      const after = parts.slice(productIdx + 3)
      const slug = after.length > 0 ? after[after.length - 1] : null
      const category = after.length >= 2 ? after[0] : null
      const subCategory = after.length >= 3 ? after[1] : null
      return { category, subCategory, urlId, slug }
    } catch {
      return { category: null, subCategory: null, urlId: null, slug: null }
    }
  }

  private extractVolume(text: string): string | null {
    // Birimden sonra harf gelmemeli (ör. "10 günlük" → "10g" hatasını önler)
    const m = text.match(/(\d+(?:[.,]\d+)?)\s?(ml|lt|l|gr|g)(?![a-zçğıöşü0-9])/i)
    return m ? `${m[1]}${m[2].toLowerCase()}` : null
  }

  private decodeEntities(s: string): string {
    return s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, " ")
  }
}
