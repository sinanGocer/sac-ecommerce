/**
 * Category Enrichment — kategori HTML'indeki inline `catalog-mpp` JSON'undan
 * tam ürün verisi çıkarır (SAF, IO yok, AĞ YOK).
 *
 * Aveda kategori sayfaları ürün kartlarını `<script type="application/json">`
 * içinde `catalog-mpp.categories[].products[]` olarak taşır. Buradan title,
 * canonical URL, external_id (PROD_BASE_ID = URL'deki 2. id), TRY fiyat (default
 * SKU), görsel, hacim (PRODUCT_SIZE), SKU/EAN (UPC_CODE) çıkarılır.
 */

import { canonicalizeUrl, extractExternalId } from "./assisted-import-validate"
import { DEFAULT_AVEDA_BASE } from "./category-discovery"

export type EnrichClassification =
  | "import_ready"
  | "missing_price"
  | "missing_image"
  | "missing_title"
  | "duplicate"
  | "quarantine"

export interface EnrichedProduct {
  external_id: string | null
  canonical_url: string | null
  title: string | null
  price_try: number | null
  image: string | null
  volume: string | null
  sku: string | null
  ean: string | null
  in_stock: boolean
  category: string | null
  source_file: string
  classification: EnrichClassification
}

/** HTML'deki application/json script(ler)inden catalog-mpp ürünlerini toplar. */
export function parseCatalogMppProducts(html: string): any[] {
  const re = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi
  const products: any[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    let json: any
    try {
      json = JSON.parse(m[1].trim())
    } catch {
      continue
    }
    const mpp = json?.["catalog-mpp"]
    const cats = mpp?.categories
    if (!Array.isArray(cats)) continue
    for (const cat of cats) {
      if (Array.isArray(cat?.products)) {
        for (const p of cat.products) {
          products.push({ ...p, __category_name: cat?.PROD_CAT_NAME ?? cat?.name ?? null })
        }
      }
    }
  }
  return products
}

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (Array.isArray(value)) {
    for (const v of value) if (typeof v === "string" && v.trim()) return v.trim()
  }
  return null
}

function toAbsoluteImage(path: string | null, base: string): string | null {
  if (!path) return null
  try {
    return new URL(path, base).toString()
  } catch {
    return null
  }
}

function priceNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null
  if (typeof value === "string") {
    const n = Number(value.replace(/[^\d.]/g, ""))
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return null
}

/** Tek bir catalog-mpp ürün objesini EnrichedProduct'a çevirir (sınıf hariç). */
export function mapMppProduct(
  raw: any,
  sourceFile: string,
  base = DEFAULT_AVEDA_BASE
): Omit<EnrichedProduct, "classification"> {
  const sku = raw?.defaultSku ?? (Array.isArray(raw?.skus) ? raw.skus[0] : null) ?? {}
  const rawUrl = firstString(raw?.url) || firstString(raw?.rs_default_url) || null
  const canonical = rawUrl ? canonicalizeUrl(new URL(rawUrl, base).toString()) : null

  const externalId =
    raw?.PROD_BASE_ID != null
      ? String(raw.PROD_BASE_ID)
      : canonical
        ? extractExternalId(canonical)
        : null

  const image = toAbsoluteImage(
    firstString(raw?.LARGE_IMAGE) ||
      firstString(raw?.MEDIUM_IMAGE) ||
      firstString(raw?.rs_default_image) ||
      firstString(raw?.SMALL_IMAGE),
    base
  )

  const price = priceNumber(sku?.PRICE ?? sku?.rs_sku_price ?? sku?.formattedPrice)
  const availability = sku?.rs_sku_availability
  const inStock = availability === 1 || availability === "1" || availability == null

  return {
    external_id: externalId,
    canonical_url: canonical,
    title: firstString(raw?.PROD_RGN_NAME) || firstString(raw?.rs_default_name) || null,
    price_try: price,
    image,
    volume: firstString(sku?.PRODUCT_SIZE) || firstString(sku?.UNIT_SIZE) || null,
    sku: firstString(sku?.SKU_ID) || (sku?.SKU_BASE_ID != null ? String(sku.SKU_BASE_ID) : null),
    ean: firstString(sku?.UPC_CODE) || null,
    in_stock: inStock,
    category: firstString(raw?.__category_name) || null,
    source_file: sourceFile,
  }
}

function classify(
  p: Omit<EnrichedProduct, "classification">,
  isDuplicate: boolean
): EnrichClassification {
  if (!p.external_id && !p.canonical_url) return "quarantine"
  if (isDuplicate) return "duplicate"
  if (!p.title) return "missing_title"
  if (p.price_try === null) return "missing_price"
  if (!p.image) return "missing_image"
  return "import_ready"
}

/** Birden fazla dosyadan ürünleri çıkarır; external_id ile tekilleştirir/sınıflar. */
export function enrichFromFiles(
  files: Array<{ html: string; source_file: string }>,
  base = DEFAULT_AVEDA_BASE
): EnrichedProduct[] {
  const seen = new Set<string>()
  const out: EnrichedProduct[] = []
  for (const f of files) {
    for (const raw of parseCatalogMppProducts(f.html)) {
      const mapped = mapMppProduct(raw, f.source_file, base)
      const key = mapped.external_id ?? mapped.canonical_url ?? ""
      const isDup = key !== "" && seen.has(key)
      if (key) seen.add(key)
      out.push({ ...mapped, classification: classify(mapped, isDup) })
    }
  }
  return out
}

export function summarizeEnrichment(
  products: EnrichedProduct[]
): Record<EnrichClassification, number> {
  const s: Record<EnrichClassification, number> = {
    import_ready: 0, missing_price: 0, missing_image: 0, missing_title: 0, duplicate: 0, quarantine: 0,
  }
  for (const p of products) s[p.classification]++
  return s
}

/** Enriched CSV: assisted-import ile uyumlu başlıklar (url,title,price,sku,ean) + ek alanlar. */
export function toEnrichedCsv(products: EnrichedProduct[]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const header = "url,title,price,sku,ean,image,volume,in_stock,category,classification,source_file"
  const rows = products.map((p) =>
    [
      p.canonical_url ?? "",
      p.title ?? "",
      p.price_try != null ? String(p.price_try) : "",
      p.sku ?? "",
      p.ean ?? "",
      p.image ?? "",
      p.volume ?? "",
      p.in_stock ? "1" : "0",
      p.category ?? "",
      p.classification,
      p.source_file,
    ]
      .map((v) => esc(String(v)))
      .join(",")
  )
  return [header, ...rows].join("\n") + "\n"
}
