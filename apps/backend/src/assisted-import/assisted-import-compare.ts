/**
 * User-Assisted Import — mevcut katalogla karşılaştırma (SAF, deterministik).
 *
 * Kategoriler: existing / new / update / duplicate / quarantine / missing_data /
 * protected_skip. Eşleştirme: external_id > canonical handle/slug > normalize
 * title + hacim. Korunan ürünler (KVKK + 5 demo) ASLA güncellenmez/yayınlanmaz.
 */

import { normalizeTitle } from "../pricing-intelligence/competitor-matching"
import {
  ExistingProductRef,
  ExtractedProduct,
  ImportItemCategory,
  PlannedImportItem,
  PROTECTED_HANDLES,
  PROTECTED_PRODUCT_IDS,
} from "./assisted-import-policy"
import { extractSlug } from "./assisted-import-validate"

const PROTECTED_HANDLE_SET = new Set(PROTECTED_HANDLES)
const PROTECTED_ID_SET = new Set(PROTECTED_PRODUCT_IDS)

export interface CompareInput {
  extracted: ExtractedProduct[]
  existing: ExistingProductRef[]
}

function matchExisting(
  ex: ExtractedProduct,
  existing: ExistingProductRef[]
): ExistingProductRef | null {
  // 1) external_id
  if (ex.external_id) {
    const byId = existing.find((e) => e.external_id && e.external_id === ex.external_id)
    if (byId) return byId
  }
  // 2) canonical slug == handle
  const slug = ex.canonical_url ? extractSlug(ex.canonical_url) : null
  if (slug) {
    const byHandle = existing.find((e) => e.handle && e.handle === slug)
    if (byHandle) return byHandle
  }
  // 3) normalize title + volume
  if (ex.title) {
    const nt = normalizeTitle(ex.title)
    const byTitle = existing.find(
      (e) => e.normalized_title === nt && (e.volume ?? "") === (ex.volume ?? "")
    )
    if (byTitle) return byTitle
  }
  return null
}

export function compareToExisting(input: CompareInput): PlannedImportItem[] {
  const items: PlannedImportItem[] = []

  // Girişin kendi içinde duplicate tespiti (external_id / canonical / title+volume).
  const seenExternal = new Set<string>()
  const seenCanonical = new Set<string>()
  const seenTitleVol = new Set<string>()

  for (const ex of input.extracted) {
    const reasons: string[] = []
    let category: ImportItemCategory
    let matchedId: string | null = null

    // URL reddi (external_id yok ve canonical yok → geçersiz/url-dışı kayıt).
    if (!ex.external_id && !ex.canonical_url && !ex.title) {
      category = "rejected_url"
      reasons.push("no_identifiable_fields")
      items.push(plan(ex, category, matchedId, reasons))
      continue
    }

    // Giriş-içi duplicate.
    const titleVolKey = `${normalizeTitle(ex.title ?? "")}|${ex.volume ?? ""}`
    const dupExternal = ex.external_id && seenExternal.has(ex.external_id)
    const dupCanonical = ex.canonical_url && seenCanonical.has(ex.canonical_url)
    const dupTitle = ex.title && seenTitleVol.has(titleVolKey)
    if (dupExternal || dupCanonical || dupTitle) {
      reasons.push(dupExternal ? "dup_external_id" : dupCanonical ? "dup_canonical_url" : "dup_title_volume")
      items.push(plan(ex, "duplicate", null, reasons))
      continue
    }
    if (ex.external_id) seenExternal.add(ex.external_id)
    if (ex.canonical_url) seenCanonical.add(ex.canonical_url)
    if (ex.title) seenTitleVol.add(titleVolKey)

    const match = matchExisting(ex, input.existing)
    matchedId = match?.product_id ?? null

    // Korunan ürün → asla güncelleme/yeniden yayınlama.
    if (
      (matchedId && PROTECTED_ID_SET.has(matchedId)) ||
      (match?.handle && PROTECTED_HANDLE_SET.has(match.handle))
    ) {
      reasons.push("protected_product")
      items.push(plan(ex, "protected_skip", matchedId, reasons))
      continue
    }

    // Eksik zorunlu veri → quarantine/missing_data (yayınlanamaz).
    if (ex.missing_fields.length > 0) {
      reasons.push(...ex.missing_fields.map((f) => `missing:${f}`))
      category = match ? "missing_data" : "quarantine"
      items.push(plan(ex, category, matchedId, reasons))
      continue
    }

    if (match) {
      reasons.push("matched_existing")
      category = "update"
    } else {
      reasons.push("new_product")
      category = "new"
    }
    items.push(plan(ex, category, matchedId, reasons))
  }

  return items
}

function plan(
  ex: ExtractedProduct,
  category: ImportItemCategory,
  matchedId: string | null,
  reasons: string[]
): PlannedImportItem {
  return {
    ref: ex.ref,
    category,
    external_id: ex.external_id,
    canonical_url: ex.canonical_url,
    title: ex.title,
    matched_product_id: matchedId,
    reasons,
    db_writes: 0,
  }
}

export function summarize(items: PlannedImportItem[]): Record<ImportItemCategory, number> {
  const summary = {
    existing: 0, new: 0, update: 0, duplicate: 0, quarantine: 0,
    missing_data: 0, protected_skip: 0, rejected_url: 0,
  } as Record<ImportItemCategory, number>
  for (const it of items) summary[it.category]++
  return summary
}
