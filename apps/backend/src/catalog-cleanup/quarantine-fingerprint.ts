/**
 * Catalog Product Quarantine — deterministik plan fingerprint (SAF).
 *
 * Aynı veri → aynı fingerprint. Ürün veya referans durumu (ya da politika
 * sürümü) değişirse fingerprint değişir → eski commit confirm token'ı reddedilir.
 * Commit token'ı yalnız plan_fingerprint'tir.
 */

import { createHash } from "crypto"

export interface QuarantineFingerprintPayload {
  policy_version: number
  /** Merkezi Search Projection politikası sürümü (değişirse token geçersiz). */
  projection_policy_version: number
  product_id: string
  external_id: string | null
  sku: string[]
  current_status: string
  target_status: string
  current_sales_channel_ids: string[]
  target_sales_channel_ids: string[]
  projection_action: "remove" | "none"
  active_cart_line_count: number
  order_reference_count: number
  source_url: string | null
  metadata_version: number | null
}

function sha16(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16)
}

/** Anahtarları sıralı, dizileri sıralı serialize eder → deterministik. */
export function computePlanFingerprint(
  payload: QuarantineFingerprintPayload
): string {
  const canonical = JSON.stringify({
    policy_version: payload.policy_version,
    projection_policy_version: payload.projection_policy_version,
    product_id: payload.product_id,
    external_id: payload.external_id,
    sku: [...payload.sku].sort(),
    current_status: payload.current_status,
    target_status: payload.target_status,
    current_sales_channel_ids: [...payload.current_sales_channel_ids].sort(),
    target_sales_channel_ids: [...payload.target_sales_channel_ids].sort(),
    projection_action: payload.projection_action,
    active_cart_line_count: payload.active_cart_line_count,
    order_reference_count: payload.order_reference_count,
    source_url: payload.source_url,
    metadata_version: payload.metadata_version,
  })
  return sha16(canonical)
}

/** Commit confirmation: token plan_fingerprint ile birebir olmalı. */
export function isConfirmationValid(
  confirmToken: string | null | undefined,
  planFingerprint: string
): boolean {
  if (!confirmToken) return false
  return confirmToken.trim() === planFingerprint
}
