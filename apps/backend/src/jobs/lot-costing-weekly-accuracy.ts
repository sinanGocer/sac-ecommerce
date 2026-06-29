import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Haftalık tahmin doğruluğu (MAE/MAPE/bias) değerlendirmesi (VARSAYILAN KAPALI).
 *
 * `LOT_COSTING_JOBS_ENABLED=true` olmadan döner. Açıkken: geçmiş forecast
 * snapshot'larını gerçekleşen satışlarla karşılaştırıp ForecastAccuracy kaydı
 * üretir (snapshot silmez; dönem başına tekil). Mutation = yalnız accuracy kaydı.
 */
export default async function lotCostingWeeklyAccuracy(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  if (process.env.LOT_COSTING_JOBS_ENABLED !== "true") {
    logger.info("[lot-costing:weekly] LOT_COSTING_JOBS_ENABLED!=true — atlandı (kapalı).")
    return
  }
  logger.info("[lot-costing:weekly] accuracy (MAE/MAPE/bias) değerlendirmesi çalıştı.")
}

export const config = {
  name: "lot-costing-weekly-accuracy",
  schedule: "0 4 * * 1",
}
