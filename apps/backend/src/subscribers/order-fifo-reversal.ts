import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { LOT_COSTING_MODULE } from "../modules/lot-costing"
import type LotCostingService from "../modules/lot-costing/service"
import { reverseFifoForOrder } from "../inventory-costing/fifo-apply"

/**
 * Sipariş iptali → FIFO reversal (FAIL-SAFE, VARSAYILAN KAPALI).
 *
 * `LOT_COSTING_FIFO_ENABLED=true` olmadan döner. Açıkken: siparişin satış
 * allocation'larını ÖZGÜN lotlara ters kayıtla geri yükler (allocation silinmez;
 * duplicate reversal no-op).
 */
type OrderEvent = { id: string }

export default async function orderFifoReversalHandler({
  event: { data },
  container,
}: SubscriberArgs<OrderEvent>) {
  if (process.env.LOT_COSTING_FIFO_ENABLED !== "true") return

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service = container.resolve<LotCostingService>(LOT_COSTING_MODULE)
  const result = await reverseFifoForOrder(service as never, data.id, logger)
  logger.info(
    `[lot-costing] FIFO reversal order=${data.id} reversed_items=${result.reversed_items} restored=${result.restored_quantity} skipped=${result.skipped_already_reversed}`
  )
}

export const config: SubscriberConfig = {
  event: "order.canceled",
}
