import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { MedusaCategoryService } from "../services/medusa-category.service"
import { AVEDA_TAXONOMY } from "../taxonomies/brand-taxonomy"
import { SyncLogger } from "../types/product-sync.types"

/**
 * Product Sync kategori ağacını Medusa product_category entity'lerine kurar.
 * Ürün import etmez.
 *
 * Kullanım:
 *   medusa exec ./src/product-sync/scripts/bootstrap-categories.ts
 */
export default async function bootstrapCategories({ container }: ExecArgs) {
  const medusaLogger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const logger: SyncLogger = {
    info: (m) => medusaLogger.info(m),
    warn: (m) => medusaLogger.warn(m),
    error: (m) => medusaLogger.error(m),
  }

  const service = new MedusaCategoryService(container, logger)

  logger.info("══════ PRODUCT SYNC CATEGORY TREE ══════")
  service.renderTaxonomy(AVEDA_TAXONOMY).forEach((line) => logger.info(line))
  logger.info("────────────────────────────────────────")
  logger.info("[category] Ürün import edilmeyecek; yalnızca kategori ağacı kurulacak.")

  const createdOrExisting = await service.ensureTaxonomy(AVEDA_TAXONOMY)

  logger.info(
    `[category] Aveda kategori ağacı hazır. Yönetilen kategori sayısı: ${createdOrExisting.size}`
  )
}

