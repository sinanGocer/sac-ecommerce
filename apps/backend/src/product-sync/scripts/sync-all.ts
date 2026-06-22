import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { AvedaProvider } from "../providers/aveda.provider"
import { SyncService } from "../services/sync.service"
import { SyncLogger, SyncProvider } from "../types/product-sync.types"

/**
 * Tüm sağlayıcıları sırayla senkronlar — v1 (dry-run, yalnızca rapor).
 *
 * Yapılandırma ENV ile:
 *   SYNC_LIMIT=5   (varsayılan 5)
 *
 * Kullanım:
 *   npm run sync:all
 *   SYNC_LIMIT=10 npm run sync:all
 */
export default async function syncAll({ container }: ExecArgs) {
  const medusaLogger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const logger: SyncLogger = {
    info: (m) => medusaLogger.info(m),
    warn: (m) => medusaLogger.warn(m),
    error: (m) => medusaLogger.error(m),
  }

  const limitEnv = process.env.SYNC_LIMIT
  const parsedLimit = limitEnv ? parseInt(limitEnv, 10) : NaN
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 5

  logger.info(`[sync:all] SYNC_LIMIT=${limit}`)

  // v1: yalnızca Aveda. Yeni kaynaklar buraya eklenir.
  const providers: SyncProvider[] = [new AvedaProvider(logger)]

  for (const provider of providers) {
    logger.info(`════════ ${provider.name.toUpperCase()} ════════`)
    try {
      const service = new SyncService(logger, provider)
      await service.run({ dryRun: true, limit, commit: false })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`[sync:all] ${provider.name} başarısız: ${msg}`)
    }
  }

  logger.info("[sync:all] Tüm sağlayıcılar tamamlandı.")
}
