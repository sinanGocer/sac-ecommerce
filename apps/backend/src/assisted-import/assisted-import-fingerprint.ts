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
