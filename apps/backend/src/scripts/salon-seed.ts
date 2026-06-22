import { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  ProductStatus,
} from "@medusajs/framework/utils"
import {
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createTaxRegionsWorkflow,
  createInventoryLevelsWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"

/**
 * Türkiye lokalizasyon + kuaför ürünleri için ek (additive) seed script'i.
 *
 * Çalıştırma:  cd apps/backend && npx medusa exec ./src/scripts/salon-seed.ts
 *
 * Bu script mevcut demo veriyi SİLMEZ. Sadece şunları ekler/günceller:
 *  - Store'a TRY para birimini ekler ve varsayılan yapar
 *  - "Türkiye" region'ı (TRY) + tax region (tr)
 *  - Kuaför kategorileri
 *  - TRY fiyatlı örnek ürünler + stok seviyeleri
 *
 * Tekrar çalıştırılabilir: var olan region/kategori/ürünleri atlar.
 */
export default async function salonSeed({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // 1) Gerekli kayıtları runtime'da çöz (hiçbir ID tahmin edilmiyor)
  const { data: stores } = await query.graph({
    entity: "store",
    fields: ["id", "supported_currencies.currency_code"],
  })
  const store = stores[0]

  const { data: salesChannels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
  })
  const defaultSalesChannel =
    salesChannels.find((s) => s.name === "Default Sales Channel") ??
    salesChannels[0]

  const { data: shippingProfiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
  })
  const shippingProfile = shippingProfiles[0]

  const { data: stockLocations } = await query.graph({
    entity: "stock_location",
    fields: ["id"],
  })
  const stockLocation = stockLocations[0]

  // 2) Store'a TRY ekle ve varsayılan yap (mevcut para birimlerini koru)
  logger.info("TRY para birimi ekleniyor...")
  const existing = store.supported_currencies.map((c) => c.currency_code)
  const supported_currencies = [
    { currency_code: "try", is_default: true },
    ...existing
      .filter((c) => c !== "try")
      .map((currency_code) => ({ currency_code, is_default: false })),
  ]
  await updateStoresWorkflow(container).run({
    input: { selector: { id: store.id }, update: { supported_currencies } },
  })

  // 3) Türkiye region'ı (yoksa oluştur)
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name"],
  })
  let turkeyRegion = regions.find((r) => r.name === "Türkiye")
  if (!turkeyRegion) {
    logger.info("Türkiye region'ı oluşturuluyor...")
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: "Türkiye",
            currency_code: "try",
            countries: ["tr"],
            payment_providers: ["pp_system_default"],
          },
        ],
      },
    })
    turkeyRegion = result[0]

    await createTaxRegionsWorkflow(container).run({
      input: [{ country_code: "tr", provider_id: "tp_system" }],
    })
  } else {
    logger.info("Türkiye region'ı zaten var, atlanıyor.")
  }

  // 4) Kuaför kategorileri (yoksa oluştur)
  const categoryNames = [
    "Saç Boyaları",
    "Oksidanlar",
    "Şampuanlar",
    "Saç Maskeleri & Bakım",
    "Isı Koruyucular",
  ]
  const { data: existingCats } = await query.graph({
    entity: "product_category",
    fields: ["id", "name"],
  })
  const toCreate = categoryNames.filter(
    (n) => !existingCats.some((c) => c.name === n)
  )
  if (toCreate.length) {
    logger.info(`Kategoriler oluşturuluyor: ${toCreate.join(", ")}`)
    await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: toCreate.map((name) => ({ name, is_active: true })),
      },
    })
  }
  const { data: cats } = await query.graph({
    entity: "product_category",
    fields: ["id", "name"],
  })
  const catId = (name: string) => cats.find((c) => c.name === name)!.id

  // 5) Örnek ürünler (TRY fiyatlı) — sadece eksik olanları ekle
  const products = [
    {
      title: "Profesyonel Saç Boyası 7.0 Kumral",
      handle: "sac-boyasi-7-0-kumral",
      category: "Saç Boyaları",
      description:
        "Yoğun pigmentli, uzun ömürlü profesyonel kalıcı saç boyası. 60 ml.",
      option: { title: "Ton", values: ["7.0 Kumral", "6.0 Koyu Kumral", "8.0 Açık Kumral"] },
      price: 189,
    },
    {
      title: "Oksidan Krem %6 (20 Vol) 1000 ml",
      handle: "oksidan-6-20vol-1000ml",
      category: "Oksidanlar",
      description:
        "Saç boyası ile kullanım için dengeli oksidasyon kremi. 1000 ml.",
      option: { title: "Oran", values: ["%3 (10 Vol)", "%6 (20 Vol)", "%9 (30 Vol)", "%12 (40 Vol)"] },
      price: 149,
    },
    {
      title: "Onarıcı Keratin Şampuanı 1000 ml",
      handle: "onarici-keratin-sampuani-1000ml",
      category: "Şampuanlar",
      description:
        "Yıpranmış ve boyalı saçlar için sülfatsız onarıcı şampuan. 1000 ml.",
      option: { title: "Hacim", values: ["300 ml", "1000 ml"] },
      price: 219,
    },
    {
      title: "Derin Bakım Saç Maskesi 500 ml",
      handle: "derin-bakim-sac-maskesi-500ml",
      category: "Saç Maskeleri & Bakım",
      description: "Argan ve keratin içeren yoğun nemlendirici saç maskesi. 500 ml.",
      option: { title: "Hacim", values: ["500 ml"] },
      price: 259,
    },
    {
      title: "Isı Koruyucu Sprey 200 ml",
      handle: "isi-koruyucu-sprey-200ml",
      category: "Isı Koruyucular",
      description:
        "Fön ve düzleştirici öncesi 230°C'ye kadar koruma sağlayan sprey. 200 ml.",
      option: { title: "Hacim", values: ["200 ml"] },
      price: 169,
    },
  ]

  const { data: existingProducts } = await query.graph({
    entity: "product",
    fields: ["id", "handle"],
  })
  const newProducts = products.filter(
    (p) => !existingProducts.some((ep) => ep.handle === p.handle)
  )

  if (newProducts.length) {
    logger.info(`Ürünler oluşturuluyor: ${newProducts.length} adet`)
    await createProductsWorkflow(container).run({
      input: {
        products: newProducts.map((p) => ({
          title: p.title,
          handle: p.handle,
          description: p.description,
          status: ProductStatus.PUBLISHED,
          category_ids: [catId(p.category)],
          shipping_profile_id: shippingProfile.id,
          options: [{ title: p.option.title, values: p.option.values }],
          variants: p.option.values.map((value, i) => ({
            title: value,
            sku: `${p.handle}-${i + 1}`.toUpperCase(),
            options: { [p.option.title]: value },
            prices: [{ amount: p.price, currency_code: "try" }],
          })),
          sales_channels: [{ id: defaultSalesChannel.id }],
        })),
      },
    })
  } else {
    logger.info("Tüm örnek ürünler zaten mevcut, atlanıyor.")
  }

  // 6) Stok seviyeleri — sadece henüz seviyesi olmayan inventory item'lar için
  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "location_levels.location_id"],
  })
  const itemsWithoutLevel = inventoryItems.filter(
    (item) =>
      !(item.location_levels ?? []).some(
        (l: { location_id: string }) => l.location_id === stockLocation.id
      )
  )
  if (itemsWithoutLevel.length) {
    logger.info(`Stok seviyesi ekleniyor: ${itemsWithoutLevel.length} kalem`)
    await createInventoryLevelsWorkflow(container).run({
      input: {
        inventory_levels: itemsWithoutLevel.map((item) => ({
          location_id: stockLocation.id,
          inventory_item_id: item.id,
          stocked_quantity: 1000,
        })),
      },
    })
  }

  logger.info("✅ Türkiye/TRY + kuaför ürünleri kurulumu tamamlandı.")
}
