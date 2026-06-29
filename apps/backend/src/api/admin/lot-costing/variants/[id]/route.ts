import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { LOT_COSTING_MODULE } from "../../../../../modules/lot-costing"
import type LotCostingService from "../../../../../modules/lot-costing/service"
import {
  lastPurchaseCost,
  nextFifoUnitCost,
  weightedAverageCost,
} from "../../../../../inventory-costing/fifo"
import { recommendPrice } from "../../../../../inventory-costing/recommended-price"
import {
  redactForRole,
  viewerRoleFromKeys,
} from "../../../../../inventory-costing/redaction"
import { CostLot, ProductPricingPolicy } from "../../../../../inventory-costing/inventory-costing-types"
import { resolveRoleKeys } from "../../../../../rbac/catalog-editor"

/**
 * GET /admin/lot-costing/variants/:id — READ-ONLY.
 *
 * Varyantın maliyet partileri + FIFO/ağırlıklı/son maliyet + tavsiye fiyat.
 * Yanıt rol bazında redakte edilir (catalog_editor maliyet/kâr/tedarikçi GÖRMEZ).
 * Mutation yapmaz.
 */
const DEFAULT_POLICY: ProductPricingPolicy = {
  sales_vat_rate: 0.2, payment_fee_rate: 0.0, platform_fee_rate: 0.0,
  packaging_cost: 0, shipping_contribution: 0, operational_cost: 0,
  minimum_profit_amount: 0, minimum_margin_rate: 0, target_margin_rate: 0.3,
  maximum_discount_rate: 0.3, rounding: { mode: "none", step: 0 },
}

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const variantId = req.params.id
  const service = req.scope.resolve<LotCostingService>(LOT_COSTING_MODULE)

  const roleKeys = await resolveRoleKeys(req).catch(() => new Set<string>())
  const viewer = viewerRoleFromKeys(roleKeys)

  const lotRows = (await service.listInventoryCostLots(
    { variant_id: [variantId] } as never,
    { take: 500 } as never
  ).catch(() => [])) as Array<Record<string, unknown>>

  const lots: CostLot[] = lotRows.map((l) => ({
    lot_id: String(l.id),
    received_at: String(l.received_at ?? l.created_at ?? new Date().toISOString()),
    remaining_quantity: Number(l.remaining_quantity ?? 0),
    effective_unit_cost: Number(l.effective_unit_cost ?? 0),
    status: (l.status as CostLot["status"]) ?? "active",
  }))

  const policyRow = (await service.listProductPricingPolicies(
    { variant_id: [variantId] } as never,
    { take: 1 } as never
  ).catch(() => []))[0] as Record<string, unknown> | undefined

  const policy: ProductPricingPolicy = policyRow
    ? {
        sales_vat_rate: Number(policyRow.sales_vat_rate ?? 0.2),
        payment_fee_rate: Number(policyRow.payment_fee_rate ?? 0),
        platform_fee_rate: Number(policyRow.platform_fee_rate ?? 0),
        packaging_cost: Number(policyRow.packaging_cost ?? 0),
        shipping_contribution: Number(policyRow.shipping_contribution ?? 0),
        operational_cost: Number(policyRow.operational_cost ?? 0),
        minimum_profit_amount: Number(policyRow.minimum_profit_amount ?? 0),
        minimum_margin_rate: Number(policyRow.minimum_margin_rate ?? 0),
        target_margin_rate: Number(policyRow.target_margin_rate ?? 0.3),
        maximum_discount_rate: Number(policyRow.maximum_discount_rate ?? 0.3),
        rounding: { mode: (policyRow.rounding_strategy as never) ?? "none", step: Number(policyRow.rounding_step ?? 0) },
      }
    : DEFAULT_POLICY

  const fifoCost = nextFifoUnitCost(lots)
  const wac = weightedAverageCost(lots)
  const last = lastPurchaseCost(lots)
  const recommendation = recommendPrice({
    fifo_cost: fifoCost, weighted_average_cost: wac, last_purchase_cost: last,
    current_price: null, policy,
  })

  const totalRemaining = lots.reduce((s, l) => s + l.remaining_quantity, 0)
  const stockValue = lots.reduce((s, l) => s + l.remaining_quantity * l.effective_unit_cost, 0)
  const hasUnvalued = lots.some((l) => l.status === "unvalued_opening_stock")

  const payload = {
    variant_id: variantId,
    viewer_role: viewer,
    lot_count: lots.length,
    total_remaining_quantity: totalRemaining,
    stock_value: Math.round(stockValue * 100) / 100,
    cost: { fifo: fifoCost, weighted_average_cost: wac, last_purchase_cost: last },
    price_recommendation: recommendation,
    unvalued_opening_stock: hasUnvalued || lots.length === 0,
    lots: lots.map((l, i) => ({
      lot_id: l.lot_id,
      received_at: l.received_at,
      remaining_quantity: l.remaining_quantity,
      effective_unit_cost: l.effective_unit_cost,
      status: l.status,
      lot_number: lotRows[i]?.lot_number ?? null,
      supplier_name: lotRows[i]?.supplier_name ?? null,
    })),
  }

  // catalog_editor: maliyet/tedarikçi/kâr/stok değeri payload'dan SİLİNİR.
  res.json(redactForRole(payload, viewer))
}
