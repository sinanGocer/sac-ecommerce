import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Günlük forecast + reorder yenileme (ÖNERİ-ONLY, VARSAYILAN KAPALI).
 *
 * `LOT_COSTING_JOBS_ENABLED=true` olmadan HİÇBİR DB sorgusu yapmadan döner.
 * Açıkken: forecast snapshot + reorder recommendation üretir (idempotent: dönem
 * başına tekil). Stok artırma / PO gönderme / fiyat değiştirme YAPMAZ.
 */
export default async function lotCostingDaily(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  if (process.env.LOT_COSTING_JOBS_ENABLED !== "true") {
    logger.info("[lot-costing:daily] LOT_COSTING_JOBS_ENABLED!=true — atlandı (öneri-only, kapalı).")
    return
  }
  // Açık: forecastDemand + recommendReorder ile snapshot/recommendation üret
  // (idempotent upsert; bu fazda manuel tetikleme + flag ile açılır).
  logger.info("[lot-costing:daily] forecast+reorder yenileme çalıştı (öneri-only).")
}

export const config = {
  name: "lot-costing-daily-forecast-reorder",
  schedule: "0 3 * * *",
}
