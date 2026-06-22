import { promises as fs } from "fs"
import path from "path"

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { AVEDA_PRODUCT_CATALOG_TREE } from "../architecture"
import { ProductCatalogCategoryService } from "../services/product-catalog-category.service"
import {
  REPORTS_DIR,
} from "../../product-sync/services/sync.service"
import { SyncLogger } from "../../product-sync/types/product-sync.types"

export default async function bootstrapProductCatalog({ container }: ExecArgs) {
  const medusaLogger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const logger: SyncLogger = {
    info: (m) => medusaLogger.info(m),
    warn: (m) => medusaLogger.warn(m),
    error: (m) => medusaLogger.error(m),
  }

  const service = new ProductCatalogCategoryService(container, logger)

  logger.info("══════ PRODUCT CATALOG CATEGORY TREE ══════")
  service.renderTree(AVEDA_PRODUCT_CATALOG_TREE).forEach((line) => logger.info(line))
  logger.info("───────────────────────────────────────────")
  logger.info("[catalog] Ürün import edilmeyecek; yalnızca kategori kayıtları kurulacak.")

  const result = await service.ensureTree(AVEDA_PRODUCT_CATALOG_TREE)
  const report = {
    provider: "product-catalog",
    brand: AVEDA_PRODUCT_CATALOG_TREE.brand.name,
    generatedAt: new Date().toISOString(),
    created: result.created,
    updated: result.updated,
    existing: result.existing,
    totalManaged: result.totalManaged,
  }

  await fs.mkdir(REPORTS_DIR, { recursive: true })
  const json = JSON.stringify(report, null, 2)
  const stamp = report.generatedAt.replace(/[:.]/g, "-")
  await fs.writeFile(
    path.join(REPORTS_DIR, `product-catalog-${stamp}.json`),
    json,
    "utf-8"
  )
  await fs.writeFile(
    path.join(REPORTS_DIR, "product-catalog-latest.json"),
    json,
    "utf-8"
  )

  logger.info(
    `[catalog] Aveda kategori ağacı hazır. created=${result.created.length} updated=${result.updated.length} existing=${result.existing.length} total=${result.totalManaged}`
  )
  logger.info("Rapor: sync-reports/product-catalog-latest.json")
}
