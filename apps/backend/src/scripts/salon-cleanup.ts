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
 *
 * ⚠️ HARD DELETE: Bu araç deleteProductsWorkflow/deleteProductCategoriesWorkflow
 * çağırır. Yanlışlıkla çalıştırmayı önlemek için fail-closed onay gerekir:
 *   SALON_DEMO_CLEANUP_CONFIRM=DELETE_CREATE_MEDUSA_DEMO_DATA
 * Onay verilmezse hiçbir şey silinmez (erken çıkış). Hiçbir npm script bunu
 * çağırmaz; yalnız bilinçli `medusa exec` ile çalıştırılmalıdır.
 */
const SALON_DEMO_CLEANUP_CONFIRM_TOKEN = "DELETE_CREATE_MEDUSA_DEMO_DATA"

export default async function salonCleanup({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // Fail-closed: açık onay olmadan hard delete yapılmaz.
  if (process.env.SALON_DEMO_CLEANUP_CONFIRM !== SALON_DEMO_CLEANUP_CONFIRM_TOKEN) {
    logger.warn(
      `[salon-cleanup] Fail-closed: bu araç create-medusa-app demo verisini HARD DELETE eder. ` +
        `Çalıştırmak için SALON_DEMO_CLEANUP_CONFIRM=${SALON_DEMO_CLEANUP_CONFIRM_TOKEN} gerekir. ` +
        `Hiçbir şey silinmedi.`
    )
    return
  }

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
