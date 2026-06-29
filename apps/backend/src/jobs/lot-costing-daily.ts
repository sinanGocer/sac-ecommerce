import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { LOT_COSTING_MODULE } from "../modules/lot-costing"
import type LotCostingService from "../modules/lot-costing/service"
import { forecastDemand } from "../inventory-costing/forecast"
import { recommendReorder } from "../inventory-costing/reorder"
import { DailySale, PlanningPolicy } from "../inventory-costing/inventory-costing-types"

/**
 * Günlük forecast + reorder yenileme (ÖNERİ-ONLY, VARSAYILAN KAPALI).
 *
 * `LOT_COSTING_JOBS_ENABLED=true` olmadan HİÇBİR DB sorgusu yapmadan döner.
 * Açıkken: tamamlanmış/iptal-olmayan siparişlerden varyant satış geçmişi çıkarır,
 * forecast snapshot + reorder recommendation üretir. IDEMPOTENT: aynı varyant+gün
 * için snapshot zaten varsa atlar. Stok artırma / PO / fiyat değişimi YOK.
 */
const DEFAULT_PLANNING: PlanningPolicy = {
  lead_time_days: 14, safety_stock_days: 7, target_cover_days: 30, minimum_order_quantity: 0,
  order_multiple: 1, maximum_stock_days: 120, service_level: 0.9, manual_monthly_demand: null, manual_override: false,
}

export default async function lotCostingDaily(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  if (process.env.LOT_COSTING_JOBS_ENABLED !== "true") {
    logger.info("[lot-costing:daily] LOT_COSTING_JOBS_ENABLED!=true — atlandı (öneri-only, kapalı).")
    return
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY) as {
    graph: (a: unknown, o?: unknown) => Promise<{ data?: unknown[] }>
  }
  const service = container.resolve<LotCostingService>(LOT_COSTING_MODULE)
  const today = new Date().toISOString().slice(0, 10)

  // Varyant başına gerçek satış geçmişi (iptal/test dışı tamamlanmış siparişler).
  const salesByVariant = new Map<string, Map<string, number>>()
  let skip = 0
  while (true) {
    let rows: unknown[] = []
    try {
      const r = await query.graph({ entity: "order", fields: ["id", "created_at", "status", "canceled_at", "metadata", "items.variant_id", "items.quantity"], pagination: { skip, take: 200 } })
      rows = r.data ?? []
    } catch { break }
    if (rows.length === 0) break
    for (const o of rows as any[]) {
      if (o.canceled_at || (o.metadata ?? {})?.test_order === true) continue
      const day = String(o.created_at ?? "").slice(0, 10)
      for (const it of o.items ?? []) {
        if (!it.variant_id) continue
        const m = salesByVariant.get(it.variant_id) ?? new Map<string, number>()
        m.set(day, (m.get(day) ?? 0) + Number(it.quantity ?? 0))
        salesByVariant.set(it.variant_id, m)
      }
    }
    skip += rows.length
    if (rows.length < 200) break
  }

  let snapshots = 0
  let recommendations = 0
  for (const [variantId, days] of salesByVariant) {
    try {
      // Idempotency: bugünkü snapshot varsa atla.
      const existing = await service.listDemandForecastSnapshots({ variant_id: [variantId] } as never, { take: 5 } as never).catch(() => [])
      if ((existing as any[]).some((s) => String(s.forecast_date ?? "").slice(0, 10) === today)) continue

      const history: DailySale[] = [...days.entries()].map(([date, quantity]) => ({ date, quantity }))
      const f = forecastDemand({ history, horizon_days: 30 })
      await service.createDemandForecastSnapshots({
        variant_id: variantId, forecast_date: new Date().toISOString(), horizon_days: 30,
        predicted_demand: f.predicted_demand, lower_bound: f.lower_bound, upper_bound: f.upper_bound,
        confidence_score: f.confidence_score, model_version: f.model_version, input_data_until: new Date().toISOString(),
      } as never)
      snapshots++

      const ro = recommendReorder({ daily_forecast: f.daily_average, confidence_score: f.confidence_score, available_stock: 0, reserved_stock: 0, inbound_stock: 0, policy: DEFAULT_PLANNING, unit_cost_last: null, unit_cost_weighted: null })
      await service.createReorderRecommendations({
        variant_id: variantId, current_available_stock: 0, reserved_stock: 0, inbound_stock: 0,
        forecast_demand: f.predicted_demand, safety_stock: ro.safety_stock, reorder_point: ro.reorder_point,
        recommended_quantity: ro.recommended_quantity, confidence_score: f.confidence_score, reason_codes: ro.reason_codes,
        estimated_purchase_budget: 0, status: "draft",
      } as never)
      recommendations++
    } catch (e) {
      logger.warn(`[lot-costing:daily] variant=${variantId} atlandı: ${e instanceof Error ? e.message : e}`)
    }
  }
  logger.info(`[lot-costing:daily] snapshots=${snapshots} recommendations=${recommendations} (öneri-only, 0 stok/fiyat mutation).`)
}

export const config = {
  name: "lot-costing-daily-forecast-reorder",
  schedule: "0 3 * * *",
}
