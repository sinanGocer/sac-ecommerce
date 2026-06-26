/**
 * Checkout Test Order — deterministik plan fingerprint (SAF).
 *
 * Ürün fiyatı, shipping option, provider veya plan değişirse fingerprint değişir
 * → eski commit token'ı reddedilir. Secret/publishable key DEĞERİ girmez; yalnız
 * kimlik (api key id / "defined").
 */

import { createHash } from "crypto"

export interface CheckoutTestFingerprintPayload {
  policy_version: number
  region_id: string | null
  sales_channel_id: string | null
  publishable_key_identity: string | null
  product_id: string | null
  variant_id: string | null
  sku: string | null
  quantity: number
  unit_price: number | null
  manage_inventory: boolean | null
  shipping_option_id: string | null
  shipping_amount: number | null
  payment_provider_id: string | null
  test_email: string
  country_code: string
  address_signature: string
  expected_subtotal: number
  expected_shipping_total: number
  expected_tax_total: number
  expected_grand_total: number
  planned_actions: Array<{ stage: string; status: string }>
  // v2 commit execution path
  execution_strategy_version: number
  mutation_sequence: string[]
  duplicate_order_gate: { active_test_order_count: number; marker: string }
  pre_complete_gate_version: number
  recovery_strategy_version: number
  selected_inventory_location_candidates: string[]
  cancellation_strategy_version: number
}

function sha16(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16)
}

/** Adres imzası (kişisel veri içermez; sabit test adresinin deterministik özeti). */
export function addressSignature(addr: Record<string, string>): string {
  const canonical = JSON.stringify(
    Object.keys(addr)
      .sort()
      .map((k) => [k, addr[k]])
  )
  return sha16(canonical)
}

export function computeCheckoutTestFingerprint(
  payload: CheckoutTestFingerprintPayload
): string {
  const canonical = JSON.stringify({
    policy_version: payload.policy_version,
    region_id: payload.region_id,
    sales_channel_id: payload.sales_channel_id,
    publishable_key_identity: payload.publishable_key_identity,
    product_id: payload.product_id,
    variant_id: payload.variant_id,
    sku: payload.sku,
    quantity: payload.quantity,
    unit_price: payload.unit_price,
    manage_inventory: payload.manage_inventory,
    shipping_option_id: payload.shipping_option_id,
    shipping_amount: payload.shipping_amount,
    payment_provider_id: payload.payment_provider_id,
    test_email: payload.test_email,
    country_code: payload.country_code,
    address_signature: payload.address_signature,
    expected_subtotal: payload.expected_subtotal,
    expected_shipping_total: payload.expected_shipping_total,
    expected_tax_total: payload.expected_tax_total,
    expected_grand_total: payload.expected_grand_total,
    planned_actions: payload.planned_actions.map((a) => ({ stage: a.stage, status: a.status })),
    execution_strategy_version: payload.execution_strategy_version,
    mutation_sequence: payload.mutation_sequence,
    duplicate_order_gate: payload.duplicate_order_gate,
    pre_complete_gate_version: payload.pre_complete_gate_version,
    recovery_strategy_version: payload.recovery_strategy_version,
    selected_inventory_location_candidates: [...payload.selected_inventory_location_candidates].sort(),
    cancellation_strategy_version: payload.cancellation_strategy_version,
  })
  return sha16(canonical)
}

export function isCheckoutTestConfirmationValid(
  confirmToken: string | null | undefined,
  planFingerprint: string
): boolean {
  if (!confirmToken) return false
  return confirmToken.trim() === planFingerprint
}
