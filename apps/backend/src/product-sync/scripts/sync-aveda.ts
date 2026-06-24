import { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  ProductStatus,
} from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"

import { AvedaProvider } from "../providers/aveda.provider"
import {
  CommitBatchFn,
  FindExistingFn,
  SyncService,
} from "../services/sync.service"
import { AVEDA_PRODUCT_CATALOG_TREE } from "../../product-catalog/architecture"
import { ProductCatalogCategoryService } from "../../product-catalog/services/product-catalog-category.service"
import { MedusaProductDraft, SyncLogger } from "../types/product-sync.types"
import {
  mapCreatedProductsByExternalId,
  parseExternalIdAllowlist,
  resolveSyncLimit,
} from "../utils/sync-config"

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
  // Dışarıdan SYNC_LIMIT verilmişse onu kullan; yoksa/geçersizse güvenli default (5).
  const limit = resolveSyncLimit(process.env.SYNC_LIMIT)
  // Pilot allowlist + create-only (env parsing TEK yerde). Geçersiz değer → açık hata.
  const allowlist = parseExternalIdAllowlist(process.env.SYNC_ONLY_EXTERNAL_IDS)
  const createOnly = process.env.SYNC_CREATE_ONLY === "true"

  logger.info(
    `[sync:aveda] SYNC_DRY_RUN=${dryRun} SYNC_COMMIT=${commit} SYNC_LIMIT=${limit} ` +
      `SYNC_ONLY_EXTERNAL_IDS=${allowlist ? [...allowlist].join(",") : "yok"} SYNC_CREATE_ONLY=${createOnly}`
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

  const commitBatch = await buildCommitBatchFn(container, logger)
  const provider = new AvedaProvider(logger)
  const service = new SyncService(logger, provider)

  const report = await service.run(
    {
      dryRun,
      limit,
      commit,
      onlyExternalIds: allowlist ? [...allowlist] : null,
      createOnly,
    },
    findExisting,
    commitBatch
  )

  const s = report.summary
  logger.info("──────────── ÖZET ────────────")
  logger.info(
    `discovered: ${s.discovered} | selected: ${s.selected} | filtered_not_selected: ${s.filtered_not_selected} | create: ${s.create} | update: ${s.update} | review: ${s.review} | skipped_existing_create_only: ${s.skipped_existing_create_only} | committed: ${s.committed} | db_writes: ${s.db_writes}`
  )
  logger.info(
    `requested_ids: ${s.requested_external_ids} | matched: ${s.matched_external_ids} | missing: ${s.missing_requested_external_ids.join(",") || "yok"} | create_only: ${s.create_only} | commit_enabled: ${s.commit_enabled} | dry_run: ${s.dry_run}`
  )
  logger.info(
    `create_ready: ${s.create_ready} | batch_size: ${s.batch_size} | workflow_calls: ${s.workflow_calls}`
  )
  logger.info(`Rapor: sync-reports/${report.provider}-latest.json`)
}

/**
 * Batch create: TÜM doğrulanmış create draft'ları TEK createProductsWorkflow
 * çağrısında oluşturur (atomicity — N ayrı çağrı YOK). Sonuçlar STABİL kimlik
 * (metadata.external_id) ile eşleştirilir; array sırasına güvenilmez.
 */
async function buildCommitBatchFn(
  container: ExecArgs["container"],
  logger: SyncLogger
): Promise<CommitBatchFn> {
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

  const optionTitle = "Seçenek"

  const toWorkflowProduct = (draft: MedusaProductDraft) => {
    if (draft.price === null) {
      throw new Error(`Fiyatı olmayan ürün commit edilemez: ${draft.title}`)
    }
    const categoryId = draft.categoryPath
      ? categoryIds.get(draft.categoryPath.externalId) ?? null
      : null
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
    return {
      title: draft.title,
      handle: draft.handle,
      description: draft.description ?? undefined,
      images: draft.images.map((url) => ({ url })),
      thumbnail: draft.images[0],
      status: ProductStatus.PUBLISHED,
      category_ids: categoryId ? [categoryId] : [],
      shipping_profile_id: shippingProfile.id,
      options: [
        { title: optionTitle, values: variants.map((v) => v.title) },
      ],
      variants,
      sales_channels: [{ id: defaultSalesChannel.id }],
      // Sonuç eşleştirmesi için external_id ürün metadata'sına da yazılır.
      metadata: {
        ...draft.metadata,
        external_id: draft.externalId,
        source_url: draft.sourceUrl,
      },
    }
  }

  return async (drafts: MedusaProductDraft[]): Promise<Map<string, string>> => {
    if (drafts.length === 0) return new Map()

    // TEK workflow çağrısı — tüm ürünler tek input.products dizisinde.
    const { result } = await createProductsWorkflow(container).run({
      input: { products: drafts.map(toWorkflowProduct) },
    })

    const idByExternalId = mapCreatedProductsByExternalId(result)
    // Her draft eşleşmeli; eksikse fail (workflow tümünü oluşturmuş olmalı).
    for (const draft of drafts) {
      if (!idByExternalId.has(draft.externalId)) {
        throw new Error(
          `Batch create sonucu eksik: external_id=${draft.externalId} eşleşmedi.`
        )
      }
    }
    logger.info(`[sync:aveda] Batch create: ${idByExternalId.size} ürün oluşturuldu.`)
    return idByExternalId
  }
}
