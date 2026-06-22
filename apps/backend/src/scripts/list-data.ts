import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Salt-okuma teşhis script'i. Hiçbir şeyi değiştirmez.
 *
 * Çalıştırma:  cd apps/backend && npx medusa exec ./src/scripts/list-data.ts
 *
 * DB'deki kategori, koleksiyon ve ürünleri ID + handle ile listeler.
 * Böylece "Shirts/Pants/Merch" gerçekten nerede (kategori mi, koleksiyon mu)
 * ve hâlâ var mı, tahmin etmeden görürüz.
 */
export default async function listData({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: categories } = await query.graph({
    entity: "product_category",
    fields: ["id", "name", "handle", "is_active"],
  })

  const { data: collections } = await query.graph({
    entity: "product_collection",
    fields: ["id", "title", "handle"],
  })

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "status"],
  })

  logger.info(`\n================ KATEGORİLER (${categories.length}) ================`)
  categories.forEach((c) =>
    logger.info(`  [${c.id}]  name="${c.name}"  handle="${c.handle}"  active=${c.is_active}`)
  )

  logger.info(`\n================ KOLEKSİYONLAR (${collections.length}) ================`)
  collections.forEach((c) =>
    logger.info(`  [${c.id}]  title="${c.title}"  handle="${c.handle}"`)
  )

  logger.info(`\n================ ÜRÜNLER (${products.length}) ================`)
  products.forEach((p) =>
    logger.info(`  [${p.id}]  title="${p.title}"  handle="${p.handle}"  status=${p.status}`)
  )

  logger.info("\n================ ÖZET ================")
  logger.info(`Kategori: ${categories.length} | Koleksiyon: ${collections.length} | Ürün: ${products.length}`)
}
