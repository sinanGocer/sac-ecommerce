/* eslint-disable no-console */
import assert from "assert"

import {
  buildCimriFeedXml,
  escapeXml,
  FeedConfig,
  FeedSourceProduct,
  selectFeedItems,
} from "../cimri-feed-mapper"

let passed = 0
function ok(cond: unknown, label: string): void {
  assert.ok(cond, label)
  passed++
}

const config: FeedConfig = {
  storefront_base_url: "https://shop.example.com/",
  country_code: "tr",
  shipping_note: "59 TRY",
}

function product(over: Partial<FeedSourceProduct> = {}): FeedSourceProduct {
  return {
    product_id: "prod_1",
    title: "Onarıcı Şampuan",
    handle: "onarici-sampuan",
    status: "published",
    in_channel: true,
    brand: "Aveda",
    category: "Şampuanlar",
    image_url: "https://cdn/x.jpg",
    ean: "8717",
    price_try: 199,
    in_stock: true,
    volume: "200 ml",
    ...over,
  }
}

function main(): void {
  // 1) Geçerli ürün feed'e girer, doğru URL üretir.
  const items = selectFeedItems([product()], config)
  ok(items.length === 1, "1 valid product included")
  ok(items[0].product_url === "https://shop.example.com/tr/products/onarici-sampuan", "2 product url built")

  // 2) Filtre: draft / kanalsız / stok yok / fiyatsız / handle'sız DIŞLANIR.
  const filtered = selectFeedItems(
    [
      product({ product_id: "a", status: "draft" }),
      product({ product_id: "b", in_channel: false }),
      product({ product_id: "c", in_stock: false }),
      product({ product_id: "d", price_try: null }),
      product({ product_id: "e", price_try: 0 }),
      product({ product_id: "f", handle: null }),
      product({ product_id: "g" }), // geçerli
    ],
    config
  )
  ok(filtered.length === 1 && filtered[0].id === "g", "3 only published+in-channel+in-stock+priced+handle")

  // 3) XML escaping (& < > " ').
  ok(escapeXml(`a&b<c>"d'e`) === "a&amp;b&lt;c&gt;&quot;d&apos;e", "4 xml escape")
  const xml = buildCimriFeedXml(selectFeedItems([product({ title: "Saç & Bakım <x>" })], config), "2026-06-29T00:00:00Z")
  ok(xml.includes("Saç &amp; Bakım &lt;x&gt;"), "5 title escaped in xml")
  ok(xml.includes('<?xml version="1.0" encoding="UTF-8"?>') && xml.includes('count="1"'), "6 xml header + count")
  ok(xml.includes("<fiyat>199.00</fiyat>") && xml.includes("<ean>8717</ean>"), "7 price + ean elements")

  // 4) Boş ean → eleman atlanır (null güvenli).
  const noEan = buildCimriFeedXml(selectFeedItems([product({ ean: null })], config), "t")
  ok(!noEan.includes("<ean>"), "8 null ean omitted")

  // 5) Boş feed geçerli XML.
  const empty = buildCimriFeedXml([], "t")
  ok(empty.includes('count="0"') && empty.includes("</urunler>"), "9 empty feed valid")

  console.log(`[cimri-feed:test] ${passed} assertions passed`)
}

try {
  main()
} catch (e) {
  console.error("CIMRI FEED TEST FAILED:", e instanceof Error ? e.message : e)
  process.exit(1)
}
