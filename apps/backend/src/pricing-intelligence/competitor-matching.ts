/**
 * Competitive Pricing — ürün eşleştirme (SAF, deterministik).
 *
 * Öncelik: EAN/GTIN > SKU/MPN > marka+normalize ad+hacim > düşük güvenli fuzzy.
 * Yanlış hacim/varyant eşleşmesi REDDEDİLİR (volume_match=false → rejected).
 */

import {
  MatchConfidence,
  MATCH_METHOD_CONFIDENCE,
  MatchMethod,
} from "./pricing-policy"

export interface OurProductKey {
  ean: string | null
  gtin: string | null
  sku: string | null
  mpn: string | null
  brand: string | null
  normalized_title: string
  volume: string | null
}

export interface CompetitorKey {
  ean: string | null
  gtin: string | null
  sku: string | null
  mpn: string | null
  brand: string | null
  normalized_title: string
  volume: string | null
}

export interface MatchResult {
  method: MatchMethod
  confidence: MatchConfidence
  volume_ok: boolean
  reasons: string[]
}

/** Alfanümerik küçük harfe katlar (kod karşılaştırması için). */
export function foldCode(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

/** Başlığı normalize eder (boşluk/işaret sadeleştirme, küçük harf). */
export function normalizeTitle(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9çğıöşü\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** İki normalize başlık için token Jaccard benzerliği (0-1). */
export function titleSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeTitle(a).split(" ").filter(Boolean))
  const tb = new Set(normalizeTitle(b).split(" ").filter(Boolean))
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  const union = ta.size + tb.size - inter
  return union === 0 ? 0 : inter / union
}

/** Hacim eşit mi (normalize: "200 ml" == "200ml"). */
export function volumeMatches(a: string | null, b: string | null): boolean {
  const fa = foldCode(a)
  const fb = foldCode(b)
  // İkisi de boşsa hacim bilgisi yok → eşleşme engellenmez (nötr).
  if (!fa && !fb) return true
  return fa === fb
}

const FUZZY_TITLE_THRESHOLD = 0.6

/**
 * En yüksek öncelikli eşleşme yöntemini belirler. Hacim uyuşmazlığı (her iki
 * tarafta da hacim VARSA ve farklıysa) eşleşmeyi REDDEDER.
 */
export function evaluateMatch(
  ours: OurProductKey,
  comp: CompetitorKey
): MatchResult {
  const reasons: string[] = []
  const volumeOk = volumeMatches(ours.volume, comp.volume)

  // Yanlış hacim → kesin reddet (üst öncelikli kodlar bile olsa farklı ürün boyu).
  if (!volumeOk) {
    return {
      method: "none",
      confidence: "rejected",
      volume_ok: false,
      reasons: ["volume_mismatch"],
    }
  }

  // 1) EAN/GTIN
  const eanA = foldCode(ours.ean || ours.gtin)
  const eanB = foldCode(comp.ean || comp.gtin)
  if (eanA && eanB && eanA === eanB) {
    return finalize("ean_gtin", true, ["ean_gtin_exact"])
  }

  // 2) SKU/MPN
  const skuA = foldCode(ours.sku || ours.mpn)
  const skuB = foldCode(comp.sku || comp.mpn)
  if (skuA && skuB && skuA === skuB) {
    return finalize("sku_mpn", true, ["sku_mpn_exact"])
  }

  // 3) Marka + normalize ad + hacim
  const brandA = foldCode(ours.brand)
  const brandB = foldCode(comp.brand)
  const sim = titleSimilarity(ours.normalized_title, comp.normalized_title)
  if (brandA && brandB && brandA === brandB && sim >= FUZZY_TITLE_THRESHOLD) {
    reasons.push(`brand_match`, `title_sim_${sim.toFixed(2)}`)
    return finalize("brand_name_volume", true, reasons)
  }

  // 4) Düşük güvenli fuzzy (yalnız başlık benzerliği)
  if (sim >= FUZZY_TITLE_THRESHOLD) {
    return finalize("fuzzy", true, [`title_sim_${sim.toFixed(2)}`])
  }

  return { method: "none", confidence: "rejected", volume_ok: volumeOk, reasons: ["no_match"] }

  function finalize(method: MatchMethod, vOk: boolean, rs: string[]): MatchResult {
    return {
      method,
      confidence: MATCH_METHOD_CONFIDENCE[method],
      volume_ok: vOk,
      reasons: rs,
    }
  }
}
