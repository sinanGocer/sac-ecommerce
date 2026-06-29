/**
 * Tavsiye edilen satış fiyatı (SAF, merkezi, deterministik).
 *
 * Efektif maliyet + KDV + komisyon + kargo + paketleme + operasyon + min kâr/marj
 * → minimum güvenli fiyat; hedef marj → önerilen fiyat. FIFO / ağırlıklı ortalama /
 * son alış maliyet tabanlarının her biri için fiyat üretir; varsayılan öneri zarar
 * riskini önlemek için bu tabanların EN YÜKSEĞİNİ kullanır. DB yazımı yok.
 */

import {
  ProductPricingPolicy,
  RoundingStrategy,
  round2,
} from "./inventory-costing-types"

export interface PriceForCostResult {
  cost_basis: number
  minimum_safe_price: number | null
  recommended_price: number | null
  estimated_profit: number | null
  estimated_margin: number | null
  error: string | null
}

function netFactor(p: ProductPricingPolicy): number {
  return 1 / (1 + p.sales_vat_rate) - p.payment_fee_rate - p.platform_fee_rate
}

/** P*(net) − giderler − maliyet = istenen kâr → P çöz. */
function priceForRequiredProfit(
  cost: number,
  requiredProfit: number,
  p: ProductPricingPolicy
): number | null {
  const factor = netFactor(p)
  if (factor <= 0) return null
  const fixed = cost + p.shipping_contribution + p.packaging_cost + p.operational_cost + requiredProfit
  return fixed / factor
}

export function applyRounding(price: number, r: RoundingStrategy): number {
  let v = price
  if (r.step && r.step > 0) v = Math.ceil(v / r.step) * r.step
  switch (r.mode) {
    case "whole":
      return Math.ceil(v)
    case "charm_90":
      return Math.floor(v) + 0.9 < v ? Math.ceil(v) + 0.9 : Math.floor(v) + 0.9
    case "charm_99":
      return Math.floor(v) + 0.99 < v ? Math.ceil(v) + 0.99 : Math.floor(v) + 0.99
    default:
      return round2(v)
  }
}

/** Tek bir maliyet tabanı için min güvenli + hedef-marj fiyatı. */
export function priceForCost(
  cost: number | null,
  policy: ProductPricingPolicy
): PriceForCostResult {
  if (cost === null || !Number.isFinite(cost) || cost < 0) {
    return { cost_basis: cost ?? 0, minimum_safe_price: null, recommended_price: null, estimated_profit: null, estimated_margin: null, error: "missing_cost" }
  }
  if (netFactor(policy) <= 0) {
    return { cost_basis: cost, minimum_safe_price: null, recommended_price: null, estimated_profit: null, estimated_margin: null, error: "vat_plus_fees_too_high" }
  }

  // Minimum güvenli: minimum kâr tutarı VE minimum marj kuralının ikisini de sağla.
  const minByAmount = priceForRequiredProfit(cost, policy.minimum_profit_amount, policy)!
  // Minimum marj: net kâr >= margin_rate * net_excl_vat. Yaklaşık: marj kârı maliyetten türet.
  const minProfitByMargin = (cost * policy.minimum_margin_rate)
  const minByMargin = priceForRequiredProfit(cost, minProfitByMargin, policy)!
  const minimumSafe = round2(Math.max(minByAmount, minByMargin))

  // Hedef: hedef marj kârı.
  const targetProfit = Math.max(cost * policy.target_margin_rate, policy.minimum_profit_amount)
  let recommended = priceForRequiredProfit(cost, targetProfit, policy)!
  recommended = round2(Math.max(recommended, minimumSafe))
  recommended = round2(applyRounding(recommended, policy.rounding))
  if (recommended < minimumSafe) recommended = round2(applyRounding(minimumSafe, { ...policy.rounding, mode: "whole" }))

  // Tahmini kâr/marj bu öneride.
  const netInclVat = recommended
  const netExclVat = netInclVat / (1 + policy.sales_vat_rate)
  const fees = netInclVat * (policy.payment_fee_rate + policy.platform_fee_rate)
  const profit = round2(netExclVat - cost - fees - policy.shipping_contribution - policy.packaging_cost - policy.operational_cost)
  const margin = netExclVat > 0 ? round2(profit / netExclVat) : 0

  return { cost_basis: round2(cost), minimum_safe_price: minimumSafe, recommended_price: recommended, estimated_profit: profit, estimated_margin: margin, error: null }
}

export interface RecommendedPriceResult {
  fifo: PriceForCostResult
  weighted_average: PriceForCostResult
  last_purchase: PriceForCostResult
  /** Zarar riskini önlemek için tabanların en yükseği. */
  default_recommended_price: number | null
  minimum_safe_price: number | null
  current_price: number | null
  loss_risk: boolean
  error: string | null
}

export function recommendPrice(params: {
  fifo_cost: number | null
  weighted_average_cost: number | null
  last_purchase_cost: number | null
  current_price: number | null
  policy: ProductPricingPolicy
}): RecommendedPriceResult {
  const fifo = priceForCost(params.fifo_cost, params.policy)
  const wac = priceForCost(params.weighted_average_cost, params.policy)
  const last = priceForCost(params.last_purchase_cost, params.policy)

  const recs = [fifo.recommended_price, wac.recommended_price, last.recommended_price].filter(
    (v): v is number => typeof v === "number"
  )
  const safes = [fifo.minimum_safe_price, wac.minimum_safe_price, last.minimum_safe_price].filter(
    (v): v is number => typeof v === "number"
  )
  const defaultRec = recs.length ? round2(Math.max(...recs)) : null
  const minimumSafe = safes.length ? round2(Math.max(...safes)) : null

  const lossRisk =
    params.current_price !== null && minimumSafe !== null && params.current_price < minimumSafe

  return {
    fifo,
    weighted_average: wac,
    last_purchase: last,
    default_recommended_price: defaultRec,
    minimum_safe_price: minimumSafe,
    current_price: params.current_price,
    loss_risk: lossRisk,
    error: defaultRec === null ? "no_cost_basis" : null,
  }
}
