import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { LOT_COSTING_MODULE } from "../modules/lot-costing"
import type LotCostingService from "../modules/lot-costing/service"
import { applyFifoForOrder } from "../inventory-costing/fifo-apply"

/**
 * Sipariş → FIFO maliyet allocation (FAIL-SAFE, VARSAYILAN KAPALI).
 *
 * `LOT_COSTING_FIFO_ENABLED=true` olmadan HİÇBİR şey yapmaz. Açıkken: completed/
 * paid gerçek sipariş için FIFO lot tüketimi + CostAllocation yazımı (idempotent:
 * order_item başına; aynı event iki kez → no-op). Test/canceled dışlanır.
 * Oversell fail-closed (allocation yazılmaz + audit warn).
 */
type OrderEvent = { id: string }

export default async function orderFifoAllocationHandler({
  event: { data },
  container,
}: SubscriberArgs<OrderEvent>) {
  if (process.env.LOT_COSTING_FIFO_ENABLED !== "true") return // fail-safe: kapalı.

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as never
  const service = container.resolve<LotCostingService>(LOT_COSTING_MODULE)

  const result = await applyFifoForOrder(service as never, query, data.id, logger)
  logger.info(
    `[lot-costing] FIFO applied order=${data.id} items=${result.applied_items} allocations=${result.written_allocations} skipped=${result.skipped_idempotent} shortfalls=${result.shortfalls} blocked_unvalued=${result.blocked_unvalued}`
  )
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
