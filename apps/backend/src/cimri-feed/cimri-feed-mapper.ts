/**
 * Cimri Feed — SAF XML mapper (IO yok).
 *
 * Yalnız published + in-channel + stokta + fiyatlı ürünler feed'e girer (filtre
 * `selectFeedItems` ile uygulanır). Cimri'nin GERÇEK teknik şeması/özel alanları
 * henüz bilinmediğinden eleman adları PROVISIONAL'dır ve tek noktadan
 * (`ELEMENT`) değiştirilebilir. Secret veya tahmin edilen özel alan HARDCODE
 * EDİLMEZ.
 */

export interface FeedSourceProduct {
  product_id: string
  title: string | null
  handle: string | null
  status: string
  in_channel: boolean
  brand: string | null
  category: string | null
  image_url: string | null
  ean: string | null
  price_try: number | null
  in_stock: boolean
  volume: string | null
}

export interface FeedItem {
  id: string
  title: string
  brand: string
  category: string
  product_url: string
  image_url: string
  price: number
  currency: "TRY"
  availability: "in stock"
  ean: string | null
  shipping: string | null
  volume: string | null
}

export interface FeedConfig {
  /** Storefront temel URL (ürün linki). */
  storefront_base_url: string
  /** Ülke/locale segmenti (örn "tr"). */
  country_code: string
  /** Kargo açıklaması (örn "59 TRY" veya "Ücretsiz"). Bilinmiyorsa null. */
  shipping_note: string | null
}

/** Feed kriterleri: published + in-channel + stokta + TRY fiyatlı. */
export function selectFeedItems(
  products: FeedSourceProduct[],
  config: FeedConfig
): FeedItem[] {
  const base = config.storefront_base_url.replace(/\/$/, "")
  return products
    .filter(
      (p) =>
        p.status === "published" &&
        p.in_channel &&
        p.in_stock &&
        typeof p.price_try === "number" &&
        p.price_try > 0 &&
        !!p.handle
    )
    .map((p) => ({
      id: p.product_id,
      title: p.title ?? "",
      brand: p.brand ?? "",
      category: p.category ?? "",
      product_url: `${base}/${config.country_code}/products/${p.handle}`,
      image_url: p.image_url ?? "",
      price: p.price_try as number,
      currency: "TRY" as const,
      availability: "in stock" as const,
      ean: p.ean,
      shipping: config.shipping_note,
      volume: p.volume,
    }))
}

const ELEMENT = {
  item: "urun",
  id: "id",
  title: "ad",
  brand: "marka",
  category: "kategori",
  url: "url",
  image: "gorsel",
  price: "fiyat",
  currency: "para_birimi",
  availability: "stok_durumu",
  ean: "ean",
  shipping: "kargo",
  volume: "hacim",
} as const

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function tag(name: string, value: string | number | null): string {
  if (value === null || value === "") return ""
  return `      <${name}>${escapeXml(String(value))}</${name}>\n`
}

export function buildCimriFeedXml(items: FeedItem[], generatedAt: string): string {
  const body = items
    .map(
      (it) =>
        `    <${ELEMENT.item}>\n` +
        tag(ELEMENT.id, it.id) +
        tag(ELEMENT.title, it.title) +
        tag(ELEMENT.brand, it.brand) +
        tag(ELEMENT.category, it.category) +
        tag(ELEMENT.url, it.product_url) +
        tag(ELEMENT.image, it.image_url) +
        tag(ELEMENT.price, it.price.toFixed(2)) +
        tag(ELEMENT.currency, it.currency) +
        tag(ELEMENT.availability, it.availability) +
        tag(ELEMENT.ean, it.ean) +
        tag(ELEMENT.shipping, it.shipping) +
        tag(ELEMENT.volume, it.volume) +
        `    </${ELEMENT.item}>`
    )
    .join("\n")

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!-- PROVISIONAL şema: Cimri resmi teknik dokümanı gelince ELEMENT eşlemesi güncellenecek. -->\n` +
    `<urunler generated_at="${escapeXml(generatedAt)}" count="${items.length}">\n` +
    body +
    `\n</urunler>\n`
  )
}
