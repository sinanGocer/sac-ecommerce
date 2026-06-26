/**
 * Türkiye Shipping Setup — deterministik plan fingerprint (SAF).
 *
 * DB state, fiyat veya threshold değişirse fingerprint değişir → eski commit
 * confirm token'ı reddedilir. Commit token'ı yalnız plan_fingerprint'tir.
 */

import { createHash } from "crypto"

export interface TrShippingFingerprintPayload {
  policy_version: number
  region_id: string | null
  country_code: string
  currency: string
  sales_channel_id: string | null
  provider_id: string
  stock_location_current_state: string
  fulfillment_set_current_state: string
  service_zone_current_state: string
  geo_zone_current_state: string
  shipping_profile_id: string | null
  shipping_option_name: string
  flat_amount: number
  free_threshold: number | null
  planned_actions: Array<{ stage: string; status: string }>
}

function sha16(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16)
}

export function computeTrShippingFingerprint(
  payload: TrShippingFingerprintPayload
): string {
  const canonical = JSON.stringify({
    policy_version: payload.policy_version,
    region_id: payload.region_id,
    country_code: payload.country_code,
    currency: payload.currency,
    sales_channel_id: payload.sales_channel_id,
    provider_id: payload.provider_id,
    stock_location_current_state: payload.stock_location_current_state,
    fulfillment_set_current_state: payload.fulfillment_set_current_state,
    service_zone_current_state: payload.service_zone_current_state,
    geo_zone_current_state: payload.geo_zone_current_state,
    shipping_profile_id: payload.shipping_profile_id,
    shipping_option_name: payload.shipping_option_name,
    flat_amount: payload.flat_amount,
    free_threshold: payload.free_threshold,
    planned_actions: payload.planned_actions.map((a) => ({
      stage: a.stage,
      status: a.status,
    })),
  })
  return sha16(canonical)
}

export function isTrShippingConfirmationValid(
  confirmToken: string | null | undefined,
  planFingerprint: string
): boolean {
  if (!confirmToken) return false
  return confirmToken.trim() === planFingerprint
}
