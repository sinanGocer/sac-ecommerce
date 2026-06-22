import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Storefront badge sistemini doldurur (opsiyonel/demo amaçlı).
 *
 * Çalıştırma:  cd apps/backend && npx medusa exec ./src/scripts/set-badges.ts
 *
 * Storefront, ürün kartında product.metadata.badge değerini gösterir.
 * Değer yoksa varsayılan "Profesyonel Seri" gösterilir.
 * Bu script seçili ürünlere "En Çok Tercih Edilen" rozetini ekler.
 */
const TOP_PICKS = [
  "sac-boyasi-7-0-kumral",
  "onarici-keratin-sampuani-1000ml",
]

export default async function setBadges({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const productModule = container.resolve(Modules.PRODUCT)

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "handle", "metadata"],
  })

  for (const p of products) {
    const badge = TOP_PICKS.includes(p.handle as string)
      ? "En Çok Tercih Edilen"
      : "Profesyonel Seri"

    await productModule.updateProducts(p.id, {
      metadata: { ...(p.metadata ?? {}), badge },
    })
    logger.info(`badge="${badge}"  ->  ${p.handle}`)
  }

  logger.info("✅ Badge metadata'ları güncellendi.")
}
