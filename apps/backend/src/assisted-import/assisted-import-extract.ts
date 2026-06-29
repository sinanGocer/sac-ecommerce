/**
 * User-Assisted Import — ürün çıkarımı (SAF, IO yok).
 *
 * Kaydedilmiş HTML'den JSON-LD Product / OG / temel etiketlerle alan çıkarır;
 * CSV/TXT kaydında alanlar doğrudan kullanılır. Ağ isteği YAPMAZ.
 */

import {
  ExtractedProduct,
  ImportInputRecord,
} from "./assisted-import-policy"
import {
  canonicalizeUrl,
  extractExternalId,
  validateProductUrl,
} from "./assisted-import-validate"

const REQUIRED_FIELDS = ["title", "price_try", "images", "volume"] as const

function firstMatch(html: string, re: RegExp): string | null {
  const m = html.match(re)
  return m ? m[1].trim() : null
}

/** HTML'deki tüm JSON-LD bloklarını parse eder. */
function parseJsonLd(html: string): any[] {
  const blocks: any[] = []
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim())
      if (Array.isArray(parsed)) blocks.push(...parsed)
      else blocks.push(parsed)
    } catch {
      // bozuk JSON-LD atlanır
    }
  }
  return blocks
}

function findProductNode(nodes: any[]): any | null {
  for (const n of nodes) {
    const type = n?.["@type"]
    if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) return n
    if (n?.["@graph"]) {
      const inner = findProductNode(n["@graph"])
      if (inner) return inner
    }
  }
  return null
}

function parseVolume(text: string | null): string | null {
  if (!text) return null
  const m = text.match(/(\d+(?:[.,]\d+)?)\s?(ml|l|gr|g|oz)\b/i)
  return m ? `${m[1]} ${m[2].toLowerCase()}` : null
}

function priceNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null
  if (typeof value === "string") {
    const n = Number(value.replace(/[^\d.]/g, ""))
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return null
}

/** Kaydedilmiş HTML sayfasından ürün çıkarır. */
export function extractFromHtml(html: string, ref: string): ExtractedProduct {
  const ld = parseJsonLd(html)
  const product = findProductNode(ld)

  const ogUrl = firstMatch(html, /<meta[^>]*property=["']og:url["'][^>]*content=["']([^"']+)["']/i)
  const ogTitle = firstMatch(html, /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
  const ogImage = firstMatch(html, /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
  const canonicalLink = firstMatch(html, /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)
  const h1 = firstMatch(html, /<h1[^>]*>([^<]+)<\/h1>/i)

  const url = product?.url || canonicalLink || ogUrl || null
  const canonical = url ? canonicalizeUrl(url) : null
  const title = (product?.name as string) || ogTitle || h1 || null

  // Görseller: JSON-LD image (string|array) + og:image.
  const images: string[] = []
  if (product?.image) {
    if (Array.isArray(product.image)) images.push(...product.image.filter((x: any) => typeof x === "string"))
    else if (typeof product.image === "string") images.push(product.image)
  }
  if (ogImage && !images.includes(ogImage)) images.push(ogImage)

  const offers = Array.isArray(product?.offers) ? product.offers[0] : product?.offers
  const price = priceNumber(offers?.price)
  const sku = (product?.sku as string) || null
  const ean = (product?.gtin13 || product?.gtin || product?.gtin12) as string | null
  const description = (product?.description as string) || firstMatch(html, /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
  const volume = parseVolume(title) || parseVolume(description)
  const category = (Array.isArray(product?.category) ? product.category[0] : product?.category) || null

  return finalize({
    external_id: canonical ? extractExternalId(canonical) : url ? extractExternalId(url) : null,
    canonical_url: canonical,
    title,
    description: description ?? null,
    images,
    price_try: price,
    sku,
    ean: ean ?? null,
    volume,
    category: category ?? null,
    ref,
  })
}

/** TXT/CSV kaydından ürün çıkarır (URL doğrulanır, alanlar kullanıcıdan). */
export function extractFromRecord(rec: ImportInputRecord): ExtractedProduct {
  const v = validateProductUrl(rec.url)
  return finalize({
    external_id: v.external_id,
    canonical_url: v.canonical_url,
    title: rec.title,
    description: null,
    images: (rec.images ?? []).filter((s): s is string => typeof s === "string" && s.length > 0),
    price_try: rec.price,
    sku: rec.sku,
    ean: rec.ean,
    volume: rec.volume ?? parseVolume(rec.title),
    category: rec.category ?? null,
    ref: rec.ref,
  })
}

function finalize(p: Omit<ExtractedProduct, "missing_fields">): ExtractedProduct {
  const missing: string[] = []
  for (const f of REQUIRED_FIELDS) {
    if (f === "images") { if (p.images.length === 0) missing.push("images") }
    else if (p[f] === null || p[f] === undefined || p[f] === "") missing.push(f)
  }
  return { ...p, missing_fields: missing }
}
