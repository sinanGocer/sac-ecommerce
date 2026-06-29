/**
 * Offline Category Discovery — kategori/listeleme HTML'lerinden ürün URL çıkarımı
 * (SAF, IO yok, AĞ İSTEĞİ YOK).
 *
 * Kullanıcının tarayıcıdan kaydettiği kategori sayfalarındaki tüm
 * /product/{id}/{id}/... bağlantılarını bulur; relative→absolute çözer; yalnız
 * resmi Aveda ürün URL'lerini kabul eder; legal/KVKK/kampanya linklerini reddeder;
 * external_id/canonical bazında tekilleştirir. Kaynak dosya + discovery nedeni
 * audit alanlarında taşınır.
 */

import { validateProductUrl } from "./assisted-import-validate"

export const DEFAULT_AVEDA_BASE = "https://www.aveda.com.tr"

export interface DiscoveredLink {
  canonical_url: string
  external_id: string
  source_file: string
  discovery_reason: string
}

export interface RejectedLink {
  url: string
  reason: string
  source_file: string
}

export interface FileDiscoveryResult {
  links: DiscoveredLink[]
  rejected: RejectedLink[]
}

/** HTML içindeki tüm href + JSON-LD url alanlarını toplar (ham aday URL'ler). */
function collectCandidateUrls(html: string): Array<{ raw: string; reason: string }> {
  const out: Array<{ raw: string; reason: string }> = []

  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = hrefRe.exec(html)) !== null) out.push({ raw: m[1], reason: "anchor_href" })

  // JSON-LD / data attribute içindeki "url": "..." ve data-url="..."
  const jsonUrlRe = /"url"\s*:\s*"([^"]+)"/gi
  while ((m = jsonUrlRe.exec(html)) !== null) out.push({ raw: m[1], reason: "json_url_field" })

  const dataUrlRe = /data-(?:product-)?url\s*=\s*["']([^"']+)["']/gi
  while ((m = dataUrlRe.exec(html)) !== null) out.push({ raw: m[1], reason: "data_url_attr" })

  return out
}

/** Aday URL'i mutlak hale getirir (relative / protocol-relative / absolute). */
export function resolveUrl(raw: string, base: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("javascript:") || trimmed.startsWith("mailto:")) {
    return null
  }
  try {
    return new URL(trimmed, base).toString()
  } catch {
    return null
  }
}

/**
 * Tek bir kategori HTML dosyasından ürün linklerini çıkarır.
 * Yalnız /product/ içeren adaylar değerlendirilir; geçerli olmayan ürün-şekilli
 * URL'ler `rejected` listesine nedeniyle yazılır (legal/kvkk vb.).
 */
export function discoverFromHtml(
  html: string,
  sourceFile: string,
  base = DEFAULT_AVEDA_BASE
): FileDiscoveryResult {
  const links: DiscoveredLink[] = []
  const rejected: RejectedLink[] = []
  const seenExternal = new Set<string>()
  const seenCanonical = new Set<string>()

  for (const cand of collectCandidateUrls(html)) {
    const resolved = resolveUrl(cand.raw, base)
    if (!resolved) continue
    // Yalnız ürün-şekilli URL'lerle ilgilen (kategori/nav linklerini sessiz atla).
    if (!resolved.includes("/product/")) continue

    const v = validateProductUrl(resolved)
    if (!v.ok || !v.external_id || !v.canonical_url) {
      rejected.push({ url: resolved, reason: v.reason ?? "invalid", source_file: sourceFile })
      continue
    }
    if (seenExternal.has(v.external_id) || seenCanonical.has(v.canonical_url)) {
      continue // dosya içi duplicate
    }
    seenExternal.add(v.external_id)
    seenCanonical.add(v.canonical_url)
    links.push({
      canonical_url: v.canonical_url,
      external_id: v.external_id,
      source_file: sourceFile,
      discovery_reason: cand.reason,
    })
  }

  return { links, rejected }
}

export interface AggregateDiscovery {
  links: DiscoveredLink[]
  rejected: RejectedLink[]
  /** external_id → kaç kez (farklı dosyalarda) görüldü. */
  duplicate_external_ids: Record<string, number>
}

/** Birden fazla dosyayı birleştirir; global tekilleştirme + duplicate sayımı. */
export function aggregateDiscovery(
  files: Array<{ html: string; source_file: string }>,
  base = DEFAULT_AVEDA_BASE
): AggregateDiscovery {
  const byExternal = new Map<string, DiscoveredLink>()
  const counts: Record<string, number> = {}
  const rejected: RejectedLink[] = []

  for (const f of files) {
    const res = discoverFromHtml(f.html, f.source_file, base)
    rejected.push(...res.rejected)
    for (const link of res.links) {
      counts[link.external_id] = (counts[link.external_id] ?? 0) + 1
      if (!byExternal.has(link.external_id)) byExternal.set(link.external_id, link)
    }
  }

  const duplicate_external_ids: Record<string, number> = {}
  for (const [id, c] of Object.entries(counts)) if (c > 1) duplicate_external_ids[id] = c

  const links = [...byExternal.values()].sort((a, b) =>
    a.external_id.localeCompare(b.external_id)
  )
  return { links, rejected, duplicate_external_ids }
}

/** CSV çıktısı: url,external_id,source_file,discovery_reason */
export function toCsv(links: DiscoveredLink[]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const header = "url,external_id,source_file,discovery_reason"
  const rows = links.map(
    (l) => [l.canonical_url, l.external_id, l.source_file, l.discovery_reason].map(esc).join(",")
  )
  return [header, ...rows].join("\n") + "\n"
}

// ── Mevcut katalogla karşılaştırma ────────────────────────────────────────────

export type DiscoveryCompareCategory = "existing" | "new" | "duplicate" | "rejected"

export interface DiscoveryComparison {
  existing: DiscoveredLink[]
  new: DiscoveredLink[]
  duplicate_external_ids: string[]
  rejected_count: number
  summary: Record<DiscoveryCompareCategory, number>
}

export function compareDiscovery(
  agg: AggregateDiscovery,
  existingExternalIds: Set<string>
): DiscoveryComparison {
  const existing: DiscoveredLink[] = []
  const fresh: DiscoveredLink[] = []
  for (const link of agg.links) {
    if (existingExternalIds.has(link.external_id)) existing.push(link)
    else fresh.push(link)
  }
  const dupIds = Object.keys(agg.duplicate_external_ids)
  return {
    existing,
    new: fresh,
    duplicate_external_ids: dupIds,
    rejected_count: agg.rejected.length,
    summary: {
      existing: existing.length,
      new: fresh.length,
      duplicate: dupIds.length,
      rejected: agg.rejected.length,
    },
  }
}
