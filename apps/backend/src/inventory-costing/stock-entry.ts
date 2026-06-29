/**
 * Stok giriş maliyet hesabı + doğrulama (SAF). Kargo + ek maliyeti alınan
 * miktara dağıtarak efektif birim maliyeti üretir. DB yazımı yapmaz; workflow
 * bunu kullanır.
 */

import { round2 } from "./inventory-costing-types"

export interface StockEntryInput {
  product_id: string
  variant_id: string
  received_quantity: number
  unit_purchase_cost: number
  purchase_vat_rate: number
  allocated_shipping_cost?: number
  allocated_additional_cost?: number
  idempotency_key: string
}

export interface StockEntryValidation {
  ok: boolean
  errors: string[]
  effective_unit_cost: number | null
}

/**
 * effective_unit_cost = birim alış + (kargo + ek maliyet) / miktar.
 * Negatif değer, 0 miktar, geçersiz oran → fail-closed.
 */
export function validateAndComputeStockEntry(
  input: StockEntryInput
): StockEntryValidation {
  const errors: string[] = []
  if (!input.idempotency_key || input.idempotency_key.trim().length === 0) errors.push("missing_idempotency_key")
  if (!input.product_id || !input.variant_id) errors.push("missing_product_or_variant")
  if (!Number.isFinite(input.received_quantity) || input.received_quantity <= 0) errors.push("invalid_quantity")
  if (!Number.isFinite(input.unit_purchase_cost) || input.unit_purchase_cost < 0) errors.push("invalid_unit_cost")
  if (!(input.purchase_vat_rate >= 0 && input.purchase_vat_rate <= 1)) errors.push("vat_rate_out_of_range")
  const shipping = input.allocated_shipping_cost ?? 0
  const additional = input.allocated_additional_cost ?? 0
  if (shipping < 0 || additional < 0) errors.push("negative_extra_cost")

  if (errors.length > 0) {
    return { ok: false, errors, effective_unit_cost: null }
  }

  const perUnitExtra = (shipping + additional) / input.received_quantity
  const effective = round2(input.unit_purchase_cost + perUnitExtra)
  return { ok: true, errors: [], effective_unit_cost: effective }
}
