import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PriceChangeStore } from "../services/sync.service"

/**
 * Bekleyen bir fiyat değişikliğini ONAYLAR.
 *
 * medusa exec argüman geçirmediği için change_id ENV ile verilir:
 *   SYNC_CHANGE_ID=<change_id> npm run sync:approve
 *
 * NOT (v1): Onay durumu price-changes.json içine yazılır. Medusa fiyatına
 * uygulama, yazım açıldığında (v2) bir sonraki senkronda gerçekleşecek.
 */
export default async function approvePriceChange({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const id = process.env.SYNC_CHANGE_ID

  if (!id) {
    logger.error(
      "change_id gerekli. Kullanım: SYNC_CHANGE_ID=<change_id> npm run sync:approve"
    )
    return
  }

  const updated = await PriceChangeStore.setStatus(id, "approved")
  if (!updated) {
    logger.warn(`Fiyat değişikliği bulunamadı: ${id}`)
    return
  }

  logger.info(`✓ Onaylandı: ${updated.name} (${updated.id})`)
  logger.info(
    `   ${updated.field}: ${updated.oldValue} → ${updated.newValue} | durum: ${updated.status}`
  )
  logger.info("   Uygulama: yazım açıldığında (v2) bir sonraki senkronda yansıtılacak.")
}
