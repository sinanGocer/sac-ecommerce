/* eslint-disable no-console */
import assert from "assert"

import {
  enrichFromFiles,
  mapMppProduct,
  parseCatalogMppProducts,
  summarizeEnrichment,
  toEnrichedCsv,
} from "../category-enrich"

let passed = 0
function ok(cond: unknown, label: string): void {
  assert.ok(cond, label)
  passed++
}

function htmlWith(products: any[]): string {
  const state = { "catalog-mpp": { categories: [{ PROD_CAT_NAME: "Şampuanlar", products }] } }
  return `<html><head><script type="application/json">${JSON.stringify(state)}</script></head></html>`
}

const complete = {
  PROD_BASE_ID: 80714,
  PROD_RGN_NAME: "BOTANICAL REPAIR ŞAMPUAN ",
  url: "/product/5311/80714/sac-bakim/sampuan/botanical-repair-sampuan",
  LARGE_IMAGE: ["/media/images/products/355x600/x.jpg"],
  defaultSku: { PRICE: 2185, PRODUCT_SIZE: "200ml", SKU_ID: "SKU122891", UPC_CODE: "018084019481", rs_sku_availability: 1 },
}

function main(): void {
  // parse + map
  const prods = parseCatalogMppProducts(htmlWith([complete]))
  ok(prods.length === 1, "1 parse catalog-mpp products")
  const m = mapMppProduct(prods[0], "sampuan.html")
  ok(m.external_id === "80714", "2 external_id = PROD_BASE_ID (2nd url id)")
  ok(m.title === "BOTANICAL REPAIR ŞAMPUAN" && m.price_try === 2185, "3 title + TRY price")
  ok(m.volume === "200ml" && m.sku === "SKU122891" && m.ean === "018084019481", "4 volume/sku/ean")
  ok(m.image === "https://www.aveda.com.tr/media/images/products/355x600/x.jpg", "5 image absolute")
  ok(m.canonical_url === "https://www.aveda.com.tr/product/5311/80714/sac-bakim/sampuan/botanical-repair-sampuan", "6 canonical url")
  ok(m.in_stock === true, "7 in stock from availability")

  // classifications
  const missingPrice = { ...complete, PROD_BASE_ID: 1, url: "/product/9/1/c/s/a", defaultSku: { ...complete.defaultSku, PRICE: null } }
  const missingImage = { ...complete, PROD_BASE_ID: 2, url: "/product/9/2/c/s/a", LARGE_IMAGE: [], MEDIUM_IMAGE: [], rs_default_image: [], SMALL_IMAGE: null }
  const missingTitle = { ...complete, PROD_BASE_ID: 3, url: "/product/9/3/c/s/a", PROD_RGN_NAME: null, rs_default_name: null }
  const enriched = enrichFromFiles([
    { html: htmlWith([complete, missingPrice, missingImage, missingTitle]), source_file: "a.html" },
    { html: htmlWith([complete]), source_file: "b.html" }, // duplicate of 80714
  ])
  const s = summarizeEnrichment(enriched)
  ok(s.import_ready === 1, "8 one import_ready")
  ok(s.missing_price === 1 && s.missing_image === 1 && s.missing_title === 1, "9 missing_* classified")
  ok(s.duplicate === 1, "10 cross-file duplicate (80714 again)")

  // CSV
  const csv = toEnrichedCsv(enriched.filter((e) => e.classification === "import_ready"))
  ok(csv.split("\n")[0].startsWith("url,title,price,sku,ean"), "11 enriched csv header assisted-import compatible")
  ok(csv.includes("80714") || csv.includes("botanical-repair"), "12 csv has product row")

  // empty / no catalog-mpp
  ok(parseCatalogMppProducts("<html></html>").length === 0, "13 no json safe")

  // no-network/mutation guard
  const fs = require("fs") as typeof import("fs")
  const path = require("path") as typeof import("path")
  const file = path.resolve(process.cwd(), "src", "assisted-import", "category-enrich.ts")
  ok(!/\bfetch\(|axios|core-flows|createProductsWorkflow/i.test(fs.readFileSync(file, "utf-8")), "14 no network/mutation in enrich")

  console.log(`[category-enrich:test] ${passed} assertions passed`)
}

try {
  main()
} catch (e) {
  console.error("CATEGORY ENRICH TEST FAILED:", e instanceof Error ? e.message : e)
  process.exit(1)
}
