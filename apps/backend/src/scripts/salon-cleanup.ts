import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  deleteProductsWorkflow,
  deleteProductCategoriesWorkflow,
} from "@medusajs/medusa/core-flows"

/**
 * create-medusa-app kurulumuyla gelen demo verisini kaldırır.
 *
 * Çalıştırma:  cd apps/backend && npx medusa exec ./src/scripts/salon-cleanup.ts
 *
 * Siler:
 *  - Demo ürünler (handle: t-shirt, sweatshirt, sweatpants, shorts)
 *  - Demo kategoriler (Shirts, Sweatshirts, Pants, Merch)
 *
 * Güvenli: bulamadıklarını atlar. Salon ürün/kategorilerine dokunmaz.
 */
export default async function salonCleanup({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const demoProductHandles = ["t-shirt", "sweatshirt", "sweatpants", "shorts"]
  const demoCategoryNames = ["Shirts", "Sweatshirts", "Pants", "Merch"]

  // 1) Demo ürünleri sil
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "handle"],
  })
  const productIds = products
    .filter((p) => demoProductHandles.includes(p.handle as string))
    .map((p) => p.id)

  if (productIds.length) {
    logger.info(`Demo ürünler siliniyor: ${productIds.length} adet`)
    await deleteProductsWorkflow(container).run({ input: { ids: productIds } })
  } else {
    logger.info("Silinecek demo ürün bulunamadı.")
  }

  // 2) Demo kategorileri sil
  const { data: categories } = await query.graph({
    entity: "product_category",
    fields: ["id", "name"],
  })
  const categoryIds = categories
    .filter((c) => demoCategoryNames.includes(c.name as string))
    .map((c) => c.id)

  if (categoryIds.length) {
    logger.info(`Demo kategoriler siliniyor: ${categoryIds.length} adet`)
    await deleteProductCategoriesWorkflow(container).run({ input: categoryIds })
  } else {
    logger.info("Silinecek demo kategori bulunamadı.")
  }

  logger.info("✅ Demo veri temizliği tamamlandı.")
}
