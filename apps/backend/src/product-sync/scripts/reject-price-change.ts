import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PriceChangeStore } from "../services/sync.service"

/**
 * Bekleyen bir fiyat değişikliğini REDDEDER.
 *
 * medusa exec argüman geçirmediği için change_id ENV ile verilir:
 *   SYNC_CHANGE_ID=<change_id> npm run sync:reject
 *
 * Reddedilen değişiklik Medusa fiyatını ASLA değiştirmez.
 */
export default async function rejectPriceChange({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const id = process.env.SYNC_CHANGE_ID

  if (!id) {
    logger.error(
      "change_id gerekli. Kullanım: SYNC_CHANGE_ID=<change_id> npm run sync:reject"
    )
    return
  }

  const updated = await PriceChangeStore.setStatus(id, "rejected")
  if (!updated) {
    logger.warn(`Fiyat değişikliği bulunamadı: ${id}`)
    return
  }

  logger.info(`✗ Reddedildi: ${updated.name} (${updated.id})`)
  logger.info("   Medusa fiyatı değiştirilmeyecek.")
}
