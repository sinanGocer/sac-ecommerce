/**
 * Akıllı stok önerisi (SAF, deterministik). Gerçek satın alma OLUŞTURMAZ;
 * yalnız taslak/öneri üretir.
 *
 * reorder_point = lead_time_demand + safety_stock
 * lead_time_demand = günlük tahmini satış × lead_time_days
 * recommended_quantity = target_stock − available − inbound  (MOQ/kat yuvarlama)
 */

import { PlanningPolicy, round2 } from "./inventory-costing-types"

export interface ReorderInput {
  daily_forecast: number
  confidence_score: number
  available_stock: number
  reserved_stock: number
  inbound_stock: number
  policy: PlanningPolicy
  /** Son kullanma tarihli ürün mü (fazla stok engeli). */
  perishable?: boolean
  unit_cost_last: number | null
  unit_cost_weighted: number | null
}

export interface ReorderResult {
  daily_forecast: number
  safety_stock: number
  reorder_point: number
  target_stock: number
  recommended_quantity: number
  recommended_order_date_offset_days: number
  days_of_cover: number | null
  estimated_stockout_days: number | null
  estimated_budget_last_cost: number | null
  estimated_budget_weighted_cost: number | null
  status: "order_now" | "soon" | "sufficient" | "overstock" | "low_confidence" | "manual_review"
  reason_codes: string[]
}

/** miktarı MOQ ve order_multiple'a yukarı yuvarlar. */
function applyMoq(qty: number, policy: PlanningPolicy): number {
  let q = Math.max(0, Math.ceil(qty))
  if (policy.minimum_order_quantity > 0 && q > 0 && q < policy.minimum_order_quantity) {
    q = policy.minimum_order_quantity
  }
  if (policy.order_multiple > 1 && q > 0) {
    q = Math.ceil(q / policy.order_multiple) * policy.order_multiple
  }
  return q
}

export function recommendReorder(input: ReorderInput): ReorderResult {
  const p = input.policy
  const reasons: string[] = []

  // Manuel aylık talep override.
  const daily = p.manual_override && p.manual_monthly_demand
    ? p.manual_monthly_demand / 30
    : input.daily_forecast

  // Güvenlik stoğu: gün cinsinden + servis seviyesi belirsizlik tamponu.
  const serviceBuffer = 1 + Math.max(0, Math.min(0.5, p.service_level - 0.5))
  const safetyStock = round2(daily * p.safety_stock_days * serviceBuffer)
  const leadTimeDemand = round2(daily * p.lead_time_days)
  const reorderPoint = round2(leadTimeDemand + safetyStock)
  const targetStock = round2(daily * p.target_cover_days + safetyStock)

  const netAvailable = input.available_stock - input.reserved_stock
  const positionStock = netAvailable + input.inbound_stock

  let recommended = applyMoq(targetStock - positionStock, p)

  // maximum_stock_days aşımı engeli.
  const maxStock = round2(daily * p.maximum_stock_days)
  if (positionStock + recommended > maxStock && maxStock > 0) {
    recommended = applyMoq(Math.max(0, maxStock - positionStock), p)
    reasons.push("capped_max_stock_days")
  }

  // Perishable: fazla stok engeli (hedefi target_cover ile sınırla).
  if (input.perishable) {
    const perishCap = applyMoq(Math.max(0, round2(daily * p.target_cover_days) - positionStock), p)
    if (recommended > perishCap) { recommended = perishCap; reasons.push("perishable_overstock_guard") }
  }

  const daysOfCover = daily > 0 ? round2(positionStock / daily) : null
  const stockoutDays = daily > 0 ? round2(Math.max(0, netAvailable) / daily) : null

  // Durum.
  let status: ReorderResult["status"] = "sufficient"
  const lowConf = input.confidence_score < 0.3
  if (lowConf) { status = "low_confidence"; reasons.push("low_confidence_warn_not_auto") }
  else if (netAvailable <= reorderPoint && recommended > 0) { status = "order_now"; reasons.push("at_or_below_reorder_point") }
  else if (daysOfCover !== null && daysOfCover <= p.lead_time_days + p.safety_stock_days) { status = "soon"; reasons.push("cover_near_lead_time") }
  else if (daysOfCover !== null && daysOfCover > p.maximum_stock_days) { status = "overstock"; recommended = 0; reasons.push("overstock") }

  // Düşük confidence'ta otomatik öneri yerine uyarı: miktarı 0'a çek.
  if (lowConf) recommended = 0

  // Negatif öneri 0.
  if (recommended < 0) recommended = 0

  const orderDateOffset = daysOfCover !== null ? Math.max(0, Math.floor(daysOfCover - p.lead_time_days - p.safety_stock_days)) : 0

  return {
    daily_forecast: round2(daily),
    safety_stock: safetyStock,
    reorder_point: reorderPoint,
    target_stock: targetStock,
    recommended_quantity: recommended,
    recommended_order_date_offset_days: orderDateOffset,
    days_of_cover: daysOfCover,
    estimated_stockout_days: stockoutDays,
    estimated_budget_last_cost: input.unit_cost_last != null ? round2(recommended * input.unit_cost_last) : null,
    estimated_budget_weighted_cost: input.unit_cost_weighted != null ? round2(recommended * input.unit_cost_weighted) : null,
    status,
    reason_codes: reasons,
  }
}
