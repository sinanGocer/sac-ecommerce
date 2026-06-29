import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { LOT_COSTING_MODULE } from "../../../../modules/lot-costing"
import type LotCostingService from "../../../../modules/lot-costing/service"
import { redactForRole, viewerRoleFromKeys } from "../../../../inventory-costing/redaction"
import { resolveRoleKeys } from "../../../../rbac/catalog-editor"

/**
 * GET /admin/lot-costing/dashboard — READ-ONLY özet.
 * Reorder/stockout/overstock + stok değeri (yalnız owner). catalog_editor için
 * stok değeri/bağlı sermaye redacted. Mutation yok.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const viewer = viewerRoleFromKeys(await resolveRoleKeys(req).catch(() => new Set<string>()))
  const service = req.scope.resolve<LotCostingService>(LOT_COSTING_MODULE)

  const recs = (await service.listReorderRecommendations({} as never, { take: 1000 } as never).catch(() => [])) as Array<Record<string, unknown>>
  const lots = (await service.listInventoryCostLots({ status: ["active"] } as never, { take: 100000, select: ["remaining_quantity", "effective_unit_cost"] } as never).catch(() => [])) as Array<{ remaining_quantity?: number; effective_unit_cost?: number }>

  const byStatus = (s: string) => recs.filter((r) => r.status === s)
  const stockValue = Math.round(lots.reduce((acc, l) => acc + Number(l.remaining_quantity ?? 0) * Number(l.effective_unit_cost ?? 0), 0) * 100) / 100

  const payload = {
    viewer_role: viewer,
    order_now: byStatus("order_now").length,
    soon_stockout: byStatus("soon").length,
    overstock: byStatus("overstock").length,
    recommendations_total: recs.length,
    active_lots: lots.length,
    stock_value: stockValue,
    tied_up_capital: stockValue,
    note: recs.length === 0 ? "Henüz öneri yok — forecast/reorder job'larını çalıştırın (LOT_COSTING_JOBS_ENABLED)." : undefined,
  }
  res.json(redactForRole(payload, viewer))
}
