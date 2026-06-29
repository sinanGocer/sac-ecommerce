/**
 * Gerçek kâr-zarar hesabı (SAF, deterministik).
 * Sipariş satırı + FIFO maliyet allocation'ı + pricing policy → P&L dökümü.
 */

import {
  ProductPricingPolicy,
  round2,
} from "./inventory-costing-types"

export interface ProfitInput {
  /** Brüt satış geliri (KDV dahil, indirim öncesi). */
  gross_revenue: number
  /** Uygulanan indirim (TL). */
  discount: number
  /** FIFO allocation toplam gerçek ürün maliyeti (KDV hariç). */
  product_cost: number
  /** Refund/iade tutarı (KDV dahil). */
  refund: number
  policy: Pick<
    ProductPricingPolicy,
    "sales_vat_rate" | "payment_fee_rate" | "platform_fee_rate" | "packaging_cost" | "shipping_contribution" | "operational_cost"
  >
}

export interface ProfitResult {
  gross_revenue: number
  discount: number
  net_revenue_incl_vat: number
  sales_vat: number
  net_revenue_excl_vat: number
  product_cost: number
  payment_fee: number
  platform_fee: number
  shipping_contribution: number
  packaging_cost: number
  operational_cost: number
  refund_effect: number
  gross_profit: number
  net_profit: number
  margin_rate: number
  loss: boolean
}

export function computeProfit(input: ProfitInput): ProfitResult {
  const p = input.policy
  const netInclVat = round2(input.gross_revenue - input.discount - input.refund)
  const vat = round2(netInclVat * (p.sales_vat_rate / (1 + p.sales_vat_rate)))
  const netExclVat = round2(netInclVat - vat)

  // Komisyonlar brüt (KDV dahil) tahsilat üzerinden.
  const paymentFee = round2(netInclVat * p.payment_fee_rate)
  const platformFee = round2(netInclVat * p.platform_fee_rate)

  // Brüt kâr = KDV'siz net gelir − ürün maliyeti.
  const grossProfit = round2(netExclVat - input.product_cost)

  // Net kâr = brüt kâr − tüm operasyonel giderler.
  const netProfit = round2(
    grossProfit -
      paymentFee -
      platformFee -
      p.shipping_contribution -
      p.packaging_cost -
      p.operational_cost
  )

  const marginRate = netExclVat > 0 ? round2(netProfit / netExclVat) : 0

  return {
    gross_revenue: round2(input.gross_revenue),
    discount: round2(input.discount),
    net_revenue_incl_vat: netInclVat,
    sales_vat: vat,
    net_revenue_excl_vat: netExclVat,
    product_cost: round2(input.product_cost),
    payment_fee: paymentFee,
    platform_fee: platformFee,
    shipping_contribution: round2(p.shipping_contribution),
    packaging_cost: round2(p.packaging_cost),
    operational_cost: round2(p.operational_cost),
    refund_effect: round2(input.refund),
    gross_profit: grossProfit,
    net_profit: netProfit,
    margin_rate: marginRate,
    loss: netProfit < 0,
  }
}
