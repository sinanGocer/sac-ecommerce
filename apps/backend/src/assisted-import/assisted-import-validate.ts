/**
 * User-Assisted Import — URL doğrulama (SAF, deterministik).
 *
 * Yalnız resmi Aveda domaini + gerçek canonical ürün sayfası kabul edilir.
 * Legal/KVKK/kampanya/kategori/sistem sayfaları reddedilir. Erişim engeli
 * AŞILMAZ — bu yalnız kullanıcının verdiği URL'leri doğrular, ağ isteği yapmaz.
 */

import { isAllowedAvedaHost } from "../product-sync/utils/sync-config"
import { UrlValidationResult } from "./assisted-import-policy"

/** Path'in herhangi bir segmentinde görülürse URL reddedilir. */
const FORBIDDEN_SEGMENTS = new Set<string>([
  "checkout", "cart", "sepet", "account", "hesabim", "login", "giris",
  "uye", "uyelik", "kvkk", "aydinlatma", "gizlilik", "cerez", "cookie",
  "legal", "policy", "terms", "kullanim-kosullari", "mesafeli-satis",
  "kampanya", "campaign", "blog", "magaza", "magazalar", "store-locator",
  "iletisim", "contact", "hakkimizda", "about", "search", "arama",
])

function pathSegments(url: string): string[] | null {
  try {
    return new URL(url).pathname.split("/").filter(Boolean)
  } catch {
    return null
  }
}

/**
 * Aveda TR ürün URL'i: /product/{masterId}/{externalId}/{kategori}/{altkategori}/{slug}
 * external_id = "product" segmentinden sonraki İKİNCİ id. (İlk id paylaşılan
 * master/category id'dir; mevcut 39 ürün metadata.external_id = ikinci id ile
 * eşleşir; örn /product/22901/62004/... → 62004.)
 */
export function extractExternalId(url: string): string | null {
  const parts = pathSegments(url)
  if (!parts) return null
  const idx = parts.indexOf("product")
  if (idx === -1 || idx + 2 >= parts.length) return null
  const id = parts[idx + 2]
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : null
}

/** Slug (ürün adı segmenti) — canonical son path parçası. */
export function extractSlug(url: string): string | null {
  const parts = pathSegments(url)
  if (!parts) return null
  const idx = parts.indexOf("product")
  if (idx === -1) return null
  const after = parts.slice(idx + 1)
  return after.length >= 4 ? after[after.length - 1].toLowerCase() : null
}

/** Canonical ürün URL'ini normalize eder (query/hash atılır, sonda / yok). */
export function canonicalizeUrl(url: string): string | null {
  try {
    const u = new URL(url)
    u.search = ""
    u.hash = ""
    return u.toString().replace(/\/$/, "")
  } catch {
    return null
  }
}

export function validateProductUrl(url: string | null): UrlValidationResult {
  if (!url || url.trim().length === 0) {
    return { ok: false, external_id: null, canonical_url: null, reason: "empty_url" }
  }
  if (!isAllowedAvedaHost(url)) {
    return { ok: false, external_id: null, canonical_url: null, reason: "not_official_aveda_domain" }
  }
  const parts = pathSegments(url)
  if (!parts || !parts.includes("product")) {
    return { ok: false, external_id: null, canonical_url: null, reason: "not_a_product_page" }
  }
  for (const seg of parts) {
    if (FORBIDDEN_SEGMENTS.has(seg.toLowerCase())) {
      return { ok: false, external_id: null, canonical_url: null, reason: `forbidden_segment:${seg.toLowerCase()}` }
    }
  }
  const externalId = extractExternalId(url)
  if (!externalId) {
    return { ok: false, external_id: null, canonical_url: null, reason: "no_external_id" }
  }
  // Gerçek canonical ürün yapısı: en az /product/{id}/{id}/{cat}/{slug}
  if (parts.slice(parts.indexOf("product") + 1).length < 4) {
    return { ok: false, external_id: externalId, canonical_url: null, reason: "incomplete_product_path" }
  }
  return {
    ok: true,
    external_id: externalId,
    canonical_url: canonicalizeUrl(url),
    reason: null,
  }
}
