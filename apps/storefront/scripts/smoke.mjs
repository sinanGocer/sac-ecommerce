#!/usr/bin/env node
/**
 * Storefront smoke / readiness check (read-only).
 *
 * Doğrular: ana sayfa + store 200, ilk/son ürün 200, demo + KVKK handle 404,
 * Store API görünür ürün sayısı ve pagination. Hiçbir mutation yapmaz, sipariş/
 * ödeme oluşturmaz. Çıkış kodu: başarısızlıkta 1.
 *
 * Çalıştırma:
 *   STOREFRONT_URL=http://localhost:8000 \
 *   MEDUSA_BACKEND_URL=http://localhost:9000 \
 *   MEDUSA_PUBLISHABLE_KEY=pk_... \
 *   node scripts/smoke.mjs
 */

const STOREFRONT =
  process.env.STOREFRONT_URL || process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:8000"
const BACKEND =
  process.env.MEDUSA_BACKEND_URL ||
  process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
  "http://localhost:9000"
const PK =
  process.env.MEDUSA_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || ""
const CC = (process.env.NEXT_PUBLIC_DEFAULT_REGION || "tr").toLowerCase()
const EXPECTED_PRODUCTS = Number(process.env.SMOKE_EXPECTED_PRODUCTS || 39)

const DEMO_HANDLES = [
  "sac-boyasi-7-0-kumral",
  "oksidan-6-20vol-1000ml",
  "onarici-keratin-sampuani-1000ml",
  "derin-bakim-sac-maskesi-500ml",
  "isi-koruyucu-sprey-200ml",
  "color-renewaltm-sac-rengi-canlandran-ve-parlaklk-katan-sac-bakm-maskeleri",
]

let failures = 0
const log = (ok, msg) => {
  console.log(`${ok ? "✓" : "✗"} ${msg}`)
  if (!ok) failures++
}

async function status(path) {
  try {
    const r = await fetch(`${STOREFRONT}${path}`, { redirect: "follow" })
    return r.status
  } catch (e) {
    return `ERR ${e.message}`
  }
}

async function storeApi(query) {
  const r = await fetch(`${BACKEND}/store/products?${query}`, {
    headers: { "x-publishable-api-key": PK },
  })
  if (!r.ok) throw new Error(`Store API ${r.status}`)
  return r.json()
}

async function main() {
  if (!PK) {
    console.error("MEDUSA_PUBLISHABLE_KEY / NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY gerekli.")
    process.exit(2)
  }

  // 1) Core pages
  log((await status(`/${CC}`)) === 200, `home /${CC} 200`)
  log((await status(`/${CC}/store`)) === 200, `store /${CC}/store 200`)

  // 2) Store API count + pagination
  let count = -1
  try {
    count = (await storeApi("limit=1")).count
  } catch (e) {
    log(false, `Store API reachable (${e.message})`)
  }
  log(count === EXPECTED_PRODUCTS, `Store API visible products = ${EXPECTED_PRODUCTS} (got ${count})`)

  const pages = []
  const offsets = Array.from(
    { length: Math.ceil(EXPECTED_PRODUCTS / 10) },
    (_, i) => i * 10
  )
  for (const off of offsets) {
    try {
      pages.push((await storeApi(`limit=10&offset=${off}&fields=handle`)).products.length)
    } catch {
      pages.push(-1)
    }
  }
  const expectedPages = offsets.map((off) => Math.min(10, Math.max(EXPECTED_PRODUCTS - off, 0)))
  log(
    JSON.stringify(pages) === JSON.stringify(expectedPages),
    `pagination ${expectedPages.join("+")} (got ${pages.join("+")})`
  )

  // 3) First & last product pages 200
  let first, last
  try {
    first = (await storeApi("limit=1&offset=0&fields=handle")).products[0]?.handle
    last = (await storeApi(`limit=1&offset=${count - 1}&fields=handle`)).products[0]?.handle
    log((await status(`/${CC}/products/${first}`)) === 200, `first product page 200 (${first})`)
    log((await status(`/${CC}/products/${last}`)) === 200, `last product page 200 (${last})`)
  } catch (e) {
    log(false, `resolve first/last product (${e.message})`)
  }

  // 4) Demo + KVKK handles must 404
  for (const h of DEMO_HANDLES) {
    log((await status(`/${CC}/products/${h}`)) === 404, `removed handle 404: ${h}`)
  }

  console.log(`\n${failures === 0 ? "SMOKE PASS" : `SMOKE FAIL (${failures})`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error("smoke error:", e)
  process.exit(1)
})
