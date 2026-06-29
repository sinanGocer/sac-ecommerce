/**
 * Competitive Pricing — deterministik öneri fingerprint (SAF).
 *
 * Aynı ürün/teklif/eşik durumu → aynı fingerprint. Gerçek fiyat yazımı (ayrı,
 * bu fazda çalışmayan commit yolu) yalnız bu fingerprint ile onaylanabilir;
 * veri değişirse token geçersiz olur.
 */

import { createHash } from "crypto"

export interface PriceFingerprintEntry {
  product_id: string
  decision: string
  current_price: number
  suggested_price: number | null
  effective_floor: number
  lowest_reliable_total: number | null
}

export interface PricingFingerprintPayload {
  policy_version: number
  mode: string
  entries: PriceFingerprintEntry[]
}

function sha16(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16)
}

export function computePricingFingerprint(
  payload: PricingFingerprintPayload
): string {
  const entries = [...payload.entries]
    .map((e) => ({
      product_id: e.product_id,
      decision: e.decision,
      current_price: e.current_price,
      suggested_price: e.suggested_price,
      effective_floor: e.effective_floor,
      lowest_reliable_total: e.lowest_reliable_total,
    }))
    .sort((a, b) => a.product_id.localeCompare(b.product_id))
  return sha16(
    JSON.stringify({
      policy_version: payload.policy_version,
      mode: payload.mode,
      entries,
    })
  )
}

export function isPricingCommitConfirmationValid(
  token: string | null | undefined,
  fingerprint: string | null
): boolean {
  if (!token || !fingerprint) return false
  return token.trim() === fingerprint
}
