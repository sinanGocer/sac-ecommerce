import { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  ProductStatus,
} from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"

import { AvedaProvider } from "../providers/aveda.provider"
import {
  CommitProductFn,
  FindExistingFn,
  SyncService,
} from "../services/sync.service"
import { AVEDA_PRODUCT_CATALOG_TREE } from "../../product-catalog/architecture"
import { ProductCatalogCategoryService } from "../../product-catalog/services/product-catalog-category.service"
import { MedusaProductDraft, SyncLogger } from "../types/product-sync.types"

/**
 * Aveda senkron.
 *
 * medusa exec CLI argüman geçirmediği için yapılandırma ENV ile alınır:
 *   SYNC_DRY_RUN=true|false   (varsayılan true)
 *   SYNC_COMMIT=true|false    (varsayılan false)
 *   SYNC_LIMIT=5              (varsayılan 5)
 *
 * Kullanım:
 *   npm run sync:aveda:dry
 *   SYNC_COMMIT=true SYNC_DRY_RUN=false SYNC_LIMIT=5 npm run sync:aveda
 */
export default async function syncAveda({ container }: ExecArgs) {
  const medusaLogger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const logger: SyncLogger = {
    info: (m) => medusaLogger.info(m),
    warn: (m) => medusaLogger.warn(m),
    error: (m) => medusaLogger.error(m),
  }

  const commit = process.env.SYNC_COMMIT === "true"
  const dryRun = commit ? process.env.SYNC_DRY_RUN !== "false" : true
  const limitEnv = process.env.SYNC_LIMIT
  const parsedLimit = limitEnv ? parseInt(limitEnv, 10) : NaN
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 5

  logger.info(
    `[sync:aveda] SYNC_DRY_RUN=${dryRun} SYNC_COMMIT=${commit} SYNC_LIMIT=${limit}`
  )
  if (commit && dryRun) {
    logger.warn(
      "[sync:aveda] Commit için SYNC_DRY_RUN=false gerekli; yalnızca rapor üretilecek."
    )
  }

  // Idempotency: mevcut ürünlerin source_url/external_id kümesini önceden çek (read-only)
  const existing = new Set<string>()
  try {
    const { data } = await query.graph({
      entity: "product",
      fields: ["id", "metadata"],
    })
    for (const p of data) {
      const m = (p.metadata ?? {}) as Record<string, unknown>
      if (typeof m.source_url === "string") existing.add(`url:${m.source_url}`)
      if (typeof m.external_id === "string") existing.add(`id:${m.external_id}`)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sync:aveda] Mevcut ürünler okunamadı (create varsayılacak): ${msg}`)
  }

  const findExisting: FindExistingFn = async (externalId, sourceUrl) =>
    existing.has(`url:${sourceUrl}`) || existing.has(`id:${externalId}`)

  const commitProduct = await buildCommitProductFn(container, logger)
  const provider = new AvedaProvider(logger)
  const service = new SyncService(logger, provider)

  const report = await service.run(
    { dryRun, limit, commit },
    findExisting,
    commitProduct
  )

  logger.info("──────────── ÖZET ────────────")
  logger.info(
    `Toplam: ${report.total} | create: ${report.summary.create} | update: ${report.summary.update} | review: ${report.summary.review} | skip: ${report.summary.skip} | yazıldı: ${report.summary.committed} | hata: ${report.summary.errors}`
  )
  logger.info(`Rapor: sync-reports/${report.provider}-latest.json`)
}

async function buildCommitProductFn(
  container: ExecArgs["container"],
  logger: SyncLogger
): Promise<CommitProductFn> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: salesChannels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
  })
  const defaultSalesChannel =
    salesChannels.find((s) => s.name === "Default Sales Channel") ??
    salesChannels[0]
  if (!defaultSalesChannel) {
    throw new Error("Medusa sales channel bulunamadı.")
  }

  const { data: shippingProfiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
  })
  const shippingProfile = shippingProfiles[0]
  if (!shippingProfile) {
    throw new Error("Medusa shipping profile bulunamadı.")
  }

  const categoryService = new ProductCatalogCategoryService(container, logger)
  const categoryResult = await categoryService.ensureTree(AVEDA_PRODUCT_CATALOG_TREE)
  const categoryIds = categoryResult.idByExternalId

  return async (draft: MedusaProductDraft, action) => {
    if (action === "update") {
      logger.warn(
        `[sync:aveda] Güncelleme commit'i henüz uygulanmıyor, mevcut ürün atlandı: ${draft.handle}`
      )
      return ""
    }

    if (draft.price === null) {
      throw new Error(`Fiyatı olmayan ürün commit edilemez: ${draft.title}`)
    }

    const categoryId = draft.categoryPath
      ? categoryIds.get(draft.categoryPath.externalId) ?? null
      : null
    const optionTitle = "Seçenek"
    const variants = draft.variants.map((variant, index) => {
      const variantPrice = variant.price ?? draft.price
      if (variantPrice === null) {
        throw new Error(`Varyant fiyatı eksik: ${draft.title}`)
      }
      const variantTitle = variant.title || "Standart"
      const sku = variant.sku ?? `${draft.handle}-${index + 1}`.toUpperCase()

      return {
        title: variantTitle,
        sku,
        options: { [optionTitle]: variantTitle },
        prices: [{ amount: variantPrice, currency_code: draft.currency }],
        manage_inventory: false,
        metadata: {
          sync_provider: draft.metadata.sync_provider,
          external_id: draft.externalId,
          source_url: draft.sourceUrl,
        },
      }
    })

    const { result } = await createProductsWorkflow(container).run({
      input: {
        products: [
          {
            title: draft.title,
            handle: draft.handle,
            description: draft.description ?? undefined,
            images: draft.images.map((url) => ({ url })),
            thumbnail: draft.images[0],
            status: ProductStatus.PUBLISHED,
            category_ids: categoryId ? [categoryId] : [],
            shipping_profile_id: shippingProfile.id,
            options: [
              {
                title: optionTitle,
                values: variants.map((variant) => variant.title),
              },
            ],
            variants,
            sales_channels: [{ id: defaultSalesChannel.id }],
            metadata: draft.metadata,
          },
        ],
      },
    })

    const created = result[0]
    if (!created?.id) {
      throw new Error(`Medusa ürün id dönmedi: ${draft.title}`)
    }

    return created.id
  }
}
