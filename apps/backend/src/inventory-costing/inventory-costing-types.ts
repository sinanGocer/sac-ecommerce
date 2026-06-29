/**
 * Lot Costing & Forecasting — paylaşılan tipler (SAF, IO yok).
 *
 * Tüm hesaplama servisleri deterministik ve test edilebilir. Para alanları
 * float yuvarlama hatasından kaçınmak için round2 ile 2 ondalığa sabitlenir.
 */

export const INVENTORY_COSTING_POLICY_VERSION = 1

export type CostMethod = "fifo" | "weighted_average" | "last_purchase"

/** Saf maliyet partisi görünümü (DB satırının read-only kopyası). */
export interface CostLot {
  lot_id: string
  received_at: string
  remaining_quantity: number
  /** Kargo + ek maliyet dağıtımı dahil efektif birim maliyet (KDV hariç). */
  effective_unit_cost: number
  status: "active" | "depleted" | "unvalued_opening_stock" | "blocked"
}

export interface FifoAllocationLine {
  lot_id: string
  allocated_quantity: number
  unit_cost: number
  total_cost: number
}

export interface RoundingStrategy {
  /** "none" | "whole" (tam TL) | "charm_90" (x,90) | "charm_99" (x,99) */
  mode: "none" | "whole" | "charm_90" | "charm_99"
  /** Fiyat adımı (örn 0.10). 0 → adım uygulanmaz. */
  step: number
}

export interface ProductPricingPolicy {
  sales_vat_rate: number
  payment_fee_rate: number
  platform_fee_rate: number
  packaging_cost: number
  shipping_contribution: number
  operational_cost: number
  minimum_profit_amount: number
  minimum_margin_rate: number
  target_margin_rate: number
  maximum_discount_rate: number
  rounding: RoundingStrategy
}

export interface DailySale {
  /** ISO yyyy-mm-dd */
  date: string
  quantity: number
  /** O gün ürün stokta değil miydi (talep düzeltmesi için). */
  out_of_stock?: boolean
  /** Bu güne ait satış iptal/test/refund mü (gerçek talep sayılmaz). */
  excluded?: boolean
}

export interface PlanningPolicy {
  lead_time_days: number
  safety_stock_days: number
  target_cover_days: number
  minimum_order_quantity: number
  order_multiple: number
  maximum_stock_days: number
  service_level: number
  manual_monthly_demand: number | null
  manual_override: boolean
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function clampRate(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}
