/**
 * Product Sync — saf yapılandırma yardımcıları (network/DB yok, deterministik).
 * Test edilebilirlik için script'lerden ayrıştırılmıştır.
 */

/** ENV'den sync limitini çözer: dışarıdan geçerli değer varsa onu, yoksa default. */
export function resolveSyncLimit(
  value: string | undefined,
  fallback = 5
): number {
  const parsed = value !== undefined ? parseInt(value, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/** Yalnız aveda.com.tr (ve alt alan adları) izinli. Redirect sonrası da çağrılır. */
export function isAllowedAvedaHost(
  urlOrHost: string,
  allowedHost = "aveda.com.tr"
): boolean {
  let host = urlOrHost
  try {
    host = new URL(urlOrHost).hostname
  } catch {
    // urlOrHost zaten host olabilir
  }
  host = host.toLowerCase()
  return host === allowedHost || host.endsWith(`.${allowedHost}`)
}

// ─────────────────────────────────────────────────────────────────────────
// Saç ürünü keşif/doğrulama filtreleri (DETERMİNİSTİK, TEK KAYNAK).
// Aveda TR URL yapısı: /product/{id}/{id}/{kategori}/{altkategori}/{slug}
// Kategori segmenti (2 id'den sonraki ilk path parçası) saç ürününün sinyalidir.
// ─────────────────────────────────────────────────────────────────────────

/** Saç ürünü kategori segmentleri (allowlist). "sac-" öneki de saç sinyalidir. */
const ALLOWED_HAIR_CATEGORY_SEGMENTS = new Set<string>([
  "sac-bakim",
  "sac-sekillendirme",
  "sac-rengi",
  "sac-derisi",
])

/** Açıkça saç-dışı kategoriler — saç kelimesi taşısa bile reddedilir. */
const EXCLUDED_CATEGORY_SEGMENTS = new Set<string>([
  "vucut-bakim",
  "makyaj",
  "parfum",
  "parfumler",
  "cilt-bakim",
  "agiz-bakim",
  "deodorant",
  "mum",
  "candle",
  "aksesuar",
  "hediye",
  "gifts",
  "gift",
])

/** Path'in HERHANGİ bir segmentinde görülürse URL reddedilir (legal/sistem). */
const FORBIDDEN_PATH_SEGMENTS = new Set<string>([
  "checkout",
  "cart",
  "sepet",
  "account",
  "hesabim",
  "login",
  "giris",
  "uye",
  "uyelik",
  "kvkk",
  "aydinlatma",
  "gizlilik",
  "cerez",
  "cookie",
  "legal",
  "policy",
  "terms",
  "kullanim-kosullari",
  "mesafeli-satis",
  "gifts",
  "gift",
  "hediye",
])

function pathSegments(url: string): string[] | null {
  try {
    return new URL(url).pathname.split("/").filter(Boolean)
  } catch {
    return null
  }
}

/** /product/{id}/{id}/ sonrasındaki kategori segmenti (yoksa null). */
export function extractAvedaCategorySegment(url: string): string | null {
  const parts = pathSegments(url)
  if (!parts) return null
  const idx = parts.indexOf("product")
  if (idx === -1) return null
  const after = parts.slice(idx + 3) // 2 id segmentinden sonrası
  return after.length >= 2 ? after[0].toLowerCase() : null
}

/**
 * Bir URL'in saç-ürünü adayı sayılması için TÜM koşullar sağlanmalı:
 *  - aveda.com.tr domaininde
 *  - gerçek /product/{id}/{id}/... yapısında
 *  - hiçbir path segmenti legal/checkout/cart/gift olmamalı
 *  - kategori segmenti açıkça saç-dışı olmamalı
 *  - kategori segmenti saç allowlist'inde veya "sac-" önekli olmalı
 */
export function isAllowedHairProductUrl(url: string): boolean {
  if (!isAllowedAvedaHost(url)) return false
  const parts = pathSegments(url)
  if (!parts || !parts.includes("product")) return false
  for (const seg of parts) {
    if (FORBIDDEN_PATH_SEGMENTS.has(seg.toLowerCase())) return false
  }
  const cat = extractAvedaCategorySegment(url)
  if (!cat) return false
  if (EXCLUDED_CATEGORY_SEGMENTS.has(cat)) return false
  return (
    ALLOWED_HAIR_CATEGORY_SEGMENTS.has(cat) ||
    cat === "sac" ||
    cat.startsWith("sac-")
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Başlık doğrulama (legal/cookie/cart/login metinleri title sayılmamalı).
// ─────────────────────────────────────────────────────────────────────────

/** Türkçe harfleri ASCII'ye katlar (büyük/küçük İ/I sorunları dahil), küçültür. */
function foldTr(s: string): string {
  return s
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .replace(/ı/g, "i")
    .replace(/Ş/g, "s")
    .replace(/ş/g, "s")
    .replace(/Ğ/g, "g")
    .replace(/ğ/g, "g")
    .replace(/Ü/g, "u")
    .replace(/ü/g, "u")
    .replace(/Ö/g, "o")
    .replace(/ö/g, "o")
    .replace(/Ç/g, "c")
    .replace(/ç/g, "c")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

const GENERIC_TITLES = new Set<string>([
  "",
  "homepage",
  "aveda",
  "anasayfa",
  "ana sayfa",
  "aveda turkiye",
  "online alisveris",
  "urunler ve fiyatlari",
])

/** Title içinde geçerse geçersiz sayılan legal/sistem/SEO ifadeleri (folded ASCII). */
const REJECTED_TITLE_SUBSTRINGS = [
  // Legal / consent
  "kisisel verilerin korunmas",
  "aydinlatma metni",
  "cerez",
  "gizlilik",
  "kullanim kosul",
  "uyelik sozles",
  "mesafeli satis",
  "on bilgilendirme",
  "kvkk",
  // Sistem / navigasyon
  "sepet",
  "giris yap",
  "uye ol",
  "alisveris sepeti",
  // Jenerik SEO / site / listeleme başlıkları
  "profesyonel sac ve vucut bakim",
  "sac ve vucut bakim urunleri",
  "urunleri ve fiyatlari",
  "urunleri & fiyatlari",
  "ve fiyatlari",
  "fiyatlari",
  "aveda turkiye",
  "online alisveris",
]

/**
 * Geçerli bir ürün başlığı mı? Boş/jenerik/legal/cart/login başlıkları reddeder.
 */
export function isValidProductTitle(title: string | null | undefined): boolean {
  if (!title) return false
  // Site suffix'ini ("… | Aveda", "… - Aveda") at; kalan gerçek ad değerlendirilir.
  const folded = foldTr(title).replace(/\s*[|\-–—]\s*aveda\s*$/, "").trim()
  if (folded.length < 3) return false
  if (GENERIC_TITLES.has(folded)) return false
  for (const bad of REJECTED_TITLE_SUBSTRINGS) {
    if (folded.includes(bad)) return false
  }
  return true
}

/**
 * Document `<title>` düşük güvenli kaynaktır. Yalnız URL slug'ı ile en az bir
 * anlamlı token (≥3 harf) paylaşıyorsa ürünle eşleşmiş kabul edilir.
 * (Jenerik SEO başlıkları zaten isValidProductTitle tarafından elenir.)
 */
export function titleMatchesSlug(
  title: string | null | undefined,
  slug: string | null | undefined
): boolean {
  if (!title || !slug) return false
  const foldedTitle = foldTr(title)
  const slugTokens = foldTr(slug.replace(/-/g, " "))
    .split(" ")
    .filter((t) => t.length >= 3)
  if (slugTokens.length === 0) return false
  return slugTokens.some((t) => foldedTitle.includes(t))
}

/** parserErrors dolu mu? Dolu ise ürün create/update edilmez, review'a düşer. */
export function hasBlockingParserError(
  parserErrors: string[] | undefined | null
): boolean {
  return Array.isArray(parserErrors) && parserErrors.length > 0
}

/** Ürün bağlamından gelen (güvenilir) fiyat kaynakları. */
const VERIFIED_PRICE_SOURCES = new Set<string>([
  "json-ld",
  "json-key",
  "data-attr",
])

/**
 * Fiyat kaynağı ürün bağlamından mı (güvenilir) yoksa global/legal fallback mı?
 * "tl-text" (sayfa geneli TL regex) ve null güvenilmez sayılır.
 */
export function isVerifiedPriceSource(source: string | null): boolean {
  return source !== null && VERIFIED_PRICE_SOURCES.has(source)
}
