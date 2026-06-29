/**
 * User-Assisted Import — deterministik plan fingerprint (SAF).
 * Gerçek import (ayrı, bu fazda çalışmayan commit yolu) yalnız bu token ile
 * onaylanır; giriş/karşılaştırma değişirse token geçersiz olur.
 */

import { createHash } from "crypto"

import { PlannedImportItem } from "./assisted-import-policy"

export interface ImportFingerprintPayload {
  policy_version: number
  items: Array<{
    ref: string
    category: string
    external_id: string | null
    canonical_url: string | null
    matched_product_id: string | null
    title: string | null
    price_try: number | null
    sku: string | null
    ean: string | null
    volume: string | null
    images: string[]
    source_category: string | null
  }>
}

function sha16(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16)
}

export function buildImportFingerprintPayload(
  policyVersion: number,
  items: PlannedImportItem[]
): ImportFingerprintPayload {
  return {
    policy_version: policyVersion,
    items: items.map((i) => ({
      ref: i.ref,
      category: i.category,
      external_id: i.external_id,
      canonical_url: i.canonical_url,
      matched_product_id: i.matched_product_id,
      title: i.title,
      price_try: i.price_try,
      sku: i.sku,
      ean: i.ean,
      volume: i.volume,
      images: [...i.images].sort(),
      source_category: i.source_category,
    })),
  }
}

export function computeImportFingerprint(payload: ImportFingerprintPayload): string {
  const items = [...payload.items].sort((a, b) => a.ref.localeCompare(b.ref))
  return sha16(JSON.stringify({ policy_version: payload.policy_version, items }))
}

export function isImportCommitConfirmationValid(
  token: string | null | undefined,
  fingerprint: string | null
): boolean {
  if (!token || !fingerprint) return false
  return token.trim() === fingerprint
}
