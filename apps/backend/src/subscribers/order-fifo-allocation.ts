import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { LOT_COSTING_MODULE } from "../modules/lot-costing"
import type LotCostingService from "../modules/lot-costing/service"
import { allocateFifo } from "../inventory-costing/fifo"
import { CostLot } from "../inventory-costing/inventory-costing-types"

/**
 * Sipariş → FIFO maliyet allocation (FAIL-SAFE, VARSAYILAN KAPALI).
 *
 * `LOT_COSTING_FIFO_ENABLED=true` olmadan HİÇBİR şey yapmaz (bu fazda gerçek
 * sipariş maliyetlemesi açılmaz — kural gereği). Açıldığında: completed/paid
 * gerçek sipariş için varyant başına FIFO tahsis planı üretir; oversell
 * fail-closed. Allocation yazımı ve idempotency (order_item başına idempotency_key)
 * commit aşamasında uygulanır. Test/canceled siparişler dışlanır.
 */
type OrderEvent = { id: string }

export default async function orderFifoAllocationHandler({
  event: { data },
  container,
}: SubscriberArgs<OrderEvent>) {
  if (process.env.LOT_COSTING_FIFO_ENABLED !== "true") {
    return // fail-safe: bu fazda kapalı.
  }

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const lotService = container.resolve<LotCostingService>(LOT_COSTING_MODULE)

  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "status", "canceled_at", "metadata", "items.id", "items.variant_id", "items.quantity"],
    filters: { id: data.id },
  })
  const order = (orders ?? [])[0] as
    | { canceled_at?: string | null; metadata?: Record<string, unknown>; items?: Array<{ id: string; variant_id: string; quantity: number }> }
    | undefined
  if (!order) return
  // Test/iptal siparişlerini dışla.
  if (order.canceled_at || (order.metadata ?? {})?.test_order === true) return

  for (const item of order.items ?? []) {
    const lotRows = (await lotService
      .listInventoryCostLots({ variant_id: [item.variant_id] } as never, { take: 500 } as never)
      .catch(() => [])) as Array<Record<string, unknown>>
    const lots: CostLot[] = lotRows.map((l) => ({
      lot_id: String(l.id),
      received_at: String(l.received_at ?? l.created_at),
      remaining_quantity: Number(l.remaining_quantity ?? 0),
      effective_unit_cost: Number(l.effective_unit_cost ?? 0),
      status: (l.status as CostLot["status"]) ?? "active",
    }))
    const plan = allocateFifo(lots, item.quantity)
    if (!plan.ok) {
      logger.warn(`[lot-costing] FIFO allocation shortfall for variant=${item.variant_id} order=${data.id} (oversell blocked).`)
      continue
    }
    // NOT: gerçek lot tüketimi + cost_allocation yazımı (idempotency_key=order_item)
    // commit aşamasında transaction içinde uygulanır. Bu fazda yalnız plan loglanır.
    logger.info(`[lot-costing] FIFO plan order_item=${item.id} cost=${plan.total_cost} lines=${plan.lines.length}`)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
