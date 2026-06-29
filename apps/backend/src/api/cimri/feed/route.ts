import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  buildCimriFeedXml,
  FeedConfig,
  FeedSourceProduct,
  selectFeedItems,
} from "../../../cimri-feed/cimri-feed-mapper"

/**
 * GET /cimri/feed — Cimri için ürün feed'i (XML, READ-ONLY).
 *
 * Yalnız published + Default Sales Channel + stokta + TRY fiyatlı ürünler.
 * `CIMRI_FEED_ENABLED=true` değilse 404. Mutation YOK.
 *
 * Not: /admin ve /store dışı bir prefix olduğundan publishable-key/admin auth
 * middleware'i uygulanmaz; feed Cimri tarafından çekilebilir olmalıdır. İstenirse
 * CIMRI_FEED_TOKEN ile basit bir query-token guard'ı eklenebilir.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (process.env.CIMRI_FEED_ENABLED !== "true") {
    res.status(404).json({ message: "Cimri feed disabled (set CIMRI_FEED_ENABLED=true)." })
    return
  }

  const requiredToken = process.env.CIMRI_FEED_TOKEN
  if (requiredToken && req.query.token !== requiredToken) {
    res.status(401).json({ message: "unauthorized" })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Default Sales Channel'ı çöz.
  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
    filters: { name: "Default Sales Channel" },
  })
  const defaultChannelId = (channels?.[0] as { id?: string })?.id ?? null

  const { data } = await query.graph({
    entity: "product",
    fields: [
      "id", "title", "handle", "status", "metadata",
      "sales_channels.id",
      "categories.name",
      "thumbnail", "images.url",
      "variants.title", "variants.manage_inventory", "variants.ean", "variants.barcode",
      "variants.prices.amount", "variants.prices.currency_code",
      "variants.options.value",
    ],
  })
  const rows = (data ?? []) as any[]

  const source: FeedSourceProduct[] = rows.map((p) => {
    const inChannel = (p.sales_channels ?? []).some(
      (c: any) => c.id === defaultChannelId
    )
    const variant = (p.variants ?? [])[0] ?? {}
    const tryPrice = (p.variants ?? [])
      .flatMap((v: any) => v.prices ?? [])
      .find((pr: any) => (pr.currency_code || "").toLowerCase() === "try")
    // manage_inventory=false → her zaman stokta. (true ise gerçek envanter
    // seviyesi entegrasyonu ileride; şimdilik muhafazakar: stokta DEĞİL say.)
    const manageInventory = (p.variants ?? []).some((v: any) => v.manage_inventory === true)
    const md = p.metadata ?? {}
    return {
      product_id: p.id,
      title: p.title ?? null,
      handle: p.handle ?? null,
      status: p.status ?? "unknown",
      in_channel: inChannel,
      brand: typeof md.brand === "string" ? md.brand : null,
      category: (p.categories ?? [])[0]?.name ?? null,
      image_url: p.thumbnail ?? (p.images ?? [])[0]?.url ?? null,
      ean: variant.ean ?? variant.barcode ?? (typeof md.ean === "string" ? md.ean : null),
      price_try: tryPrice ? Number(tryPrice.amount) : null,
      in_stock: !manageInventory,
      volume: variant.title ?? (variant.options ?? [])[0]?.value ?? null,
    }
  })

  const config: FeedConfig = {
    storefront_base_url:
      process.env.CIMRI_FEED_STOREFRONT_URL ||
      process.env.STOREFRONT_BASE_URL ||
      "https://shop.example.com",
    country_code: (process.env.CIMRI_FEED_COUNTRY || "tr").toLowerCase(),
    shipping_note: process.env.CIMRI_FEED_SHIPPING_NOTE || null,
  }

  const items = selectFeedItems(source, config)
  const xml = buildCimriFeedXml(items, new Date().toISOString())

  res.setHeader("Content-Type", "application/xml; charset=utf-8")
  res.status(200).send(xml)
}
