/* eslint-disable no-console */
import assert from "assert"

import { compareToExisting, summarize } from "../assisted-import-compare"
import { extractFromHtml } from "../assisted-import-extract"
import { isImportCommitConfirmationValid } from "../assisted-import-fingerprint"
import { parseCsv, parseTxt } from "../assisted-import-parse"
import { ExistingProductRef } from "../assisted-import-policy"
import { buildAssistedImportReport } from "../assisted-import-report"
import { planAssistedImport } from "../assisted-import-service"
import { validateProductUrl } from "../assisted-import-validate"

let passed = 0
function ok(cond: unknown, label: string): void {
  assert.ok(cond, label)
  passed++
}

const PROD = "https://www.aveda.com.tr/product/102001/102001/sac-bakim/sampuan/onarici-keratin-sampuani"
const PROD2 = "https://www.aveda.com.tr/product/102002/102002/sac-sekillendirme/sprey/isi-koruyucu-sprey-yeni"

function main(): void {
  // ── URL validation ────────────────────────────────────────────────────────
  ok(validateProductUrl(PROD).ok && validateProductUrl(PROD).external_id === "102001", "1 valid product url")
  ok(!validateProductUrl("https://evil.com/product/1/1/a/b/c").ok, "2 reject non-aveda domain")
  ok(validateProductUrl("https://www.aveda.com.tr/kvkk/aydinlatma").reason?.includes("not_a_product") ||
     validateProductUrl("https://www.aveda.com.tr/product/1/1/kvkk/x/y").reason?.startsWith("forbidden_segment"), "3 reject kvkk/legal")
  ok(validateProductUrl("https://www.aveda.com.tr/sac-bakimi").reason === "not_a_product_page", "4 reject category listing")
  ok(validateProductUrl("https://www.aveda.com.tr/product/102/102").reason === "incomplete_product_path", "5 reject incomplete path")

  // ── Parsing ─────────────────────────────────────────────────────────────
  const txt = parseTxt(`# comment\n${PROD}\n\n${PROD2}\n`)
  ok(txt.length === 2 && txt[0].url === PROD, "6 parse txt skips comments/blanks")
  const csv = parseCsv(`url,title,price,sku,ean\n${PROD},"Onarıcı Şampuan","1.299,00",VC1,8717\n`)
  ok(csv.length === 1 && csv[0].price === 1299 && csv[0].sku === "VC1" && csv[0].ean === "8717", "7 parse csv TR price")

  // ── HTML extraction (JSON-LD) ─────────────────────────────────────────────
  const html = `<html><head>
    <link rel="canonical" href="${PROD}"/>
    <meta property="og:image" content="https://cdn/x.jpg"/>
    <script type="application/ld+json">${JSON.stringify({
      "@type": "Product", name: "Onarıcı Keratin Şampuanı 200 ml",
      image: ["https://cdn/a.jpg"], sku: "VC1", gtin13: "8717",
      description: "Onarıcı şampuan 200 ml", offers: { price: "1299.00", priceCurrency: "TRY" },
    })}</script></head><body><h1>Onarıcı Keratin Şampuanı</h1></body></html>`
  const ex = extractFromHtml(html, "html:test")
  ok(ex.title === "Onarıcı Keratin Şampuanı 200 ml" && ex.price_try === 1299 && ex.sku === "VC1" && ex.ean === "8717", "8 extract JSON-LD fields")
  ok(ex.volume === "200 ml" && ex.images.length >= 1 && ex.external_id === "102001", "9 extract volume+images+external_id")
  ok(ex.missing_fields.length === 0, "10 complete product no missing fields")

  // missing data
  const htmlMissing = `<html><head><link rel="canonical" href="${PROD2}"/>
    <script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: "Isı Koruyucu" })}</script></head></html>`
  const exMissing = extractFromHtml(htmlMissing, "html:missing")
  ok(exMissing.missing_fields.includes("price_try") && exMissing.missing_fields.includes("images"), "11 missing fields detected")

  // ── Compare ───────────────────────────────────────────────────────────────
  const existing: ExistingProductRef[] = [
    { product_id: "prod_existing", external_id: "102001", handle: "onarici-keratin-sampuani", normalized_title: "onarıcı keratin şampuanı 200 ml", volume: "200 ml" },
    { product_id: "prod_01KVQHSEDTH4K5049T9PV9WPZM", external_id: "102748", handle: "color-renewaltm-sac-rengi-canlandran-ve-parlaklk-katan-sac-bakm-maskeleri", normalized_title: "kvkk", volume: null },
  ]
  const planUpdate = planAssistedImport({ records: parseTxt(PROD), existing })
  // PROD has no price/images from txt → missing_data (matched existing)
  ok(planUpdate.items[0].category === "missing_data" && planUpdate.items[0].matched_product_id === "prod_existing", "12 txt-only matched → missing_data")

  // full extract via html → update
  const planUpdate2 = planAssistedImport({ records: [{ source_format: "html", url: null, title: null, price: null, sku: null, ean: null, html, ref: "h1" }], existing })
  ok(planUpdate2.items[0].category === "update", "13 complete + matched → update")

  // new product (complete, not existing)
  const html2 = html.replace("102001", "109999").replace("onarici-keratin-sampuani", "yeni-urun").replace("Onarıcı Keratin Şampuanı 200 ml", "Yeni Ürün 100 ml")
  const planNew = planAssistedImport({ records: [{ source_format: "html", url: null, title: null, price: null, sku: null, ean: null, html: html2, ref: "h2" }], existing })
  ok(planNew.items[0].category === "new", "14 complete + not existing → new")

  // protected product never updated
  const protUrl = "https://www.aveda.com.tr/product/102748/102748/sac-bakim/maske/color-renewaltm-sac-rengi-canlandran-ve-parlaklk-katan-sac-bakm-maskeleri"
  const protHtml = `<html><head><link rel="canonical" href="${protUrl}"/><meta property="og:image" content="https://cdn/x.jpg"/>
    <script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: "KVKK 200 ml", image: ["a"], offers: { price: "100" } })}</script></head></html>`
  const planProt = planAssistedImport({ records: [{ source_format: "html", url: null, title: null, price: null, sku: null, ean: null, html: protHtml, ref: "p1" }], existing })
  ok(planProt.items[0].category === "protected_skip", "15 protected product skipped")

  // duplicate within input
  const planDup = planAssistedImport({ records: parseTxt(`${PROD}\n${PROD}`), existing })
  ok(summarize(planDup.items).duplicate === 1, "16 in-input duplicate detected")

  // ── Idempotency: same input → same fingerprint ────────────────────────────
  const a = planAssistedImport({ records: parseTxt(`${PROD}\n${PROD2}`), existing })
  const b = planAssistedImport({ records: parseTxt(`${PROD}\n${PROD2}`), existing })
  ok(a.plan_fingerprint === b.plan_fingerprint && a.total_db_writes === 0, "17 deterministic fingerprint, 0 writes")

  // empty
  ok(planAssistedImport({ records: [], existing }).decision === "ASSISTED_IMPORT_EMPTY_INPUT", "18 empty input")

  // ── Report ────────────────────────────────────────────────────────────────
  const report = buildAssistedImportReport({
    runId: "r", startedAt: "s", finishedAt: "f", inputFile: "x.txt", inputFormat: "txt",
    existingCount: existing.length, plan: planNew,
  })
  ok(report.db_writes === 0 && report.actual_mutations === 0 && report.mode === "dry-run", "19 report 0 writes")
  ok(report.commit_command !== null && report.commit_command.includes(planNew.plan_fingerprint), "20 report commit command gated")
  ok(isImportCommitConfirmationValid(planNew.plan_fingerprint, planNew.plan_fingerprint) &&
     !isImportCommitConfirmationValid("x", planNew.plan_fingerprint), "21 commit confirmation guard")

  // no-mutation guard in source
  const fs = require("fs") as typeof import("fs")
  const path = require("path") as typeof import("path")
  const dir = path.resolve(process.cwd(), "src", "assisted-import")
  for (const f of fs.readdirSync(dir).filter((x: string) => x.endsWith(".ts"))) {
    const content = fs.readFileSync(path.join(dir, f), "utf-8")
    ok(!/core-flows|createProductsWorkflow|updateProductsWorkflow|\.upsert\(/i.test(content), `22 no mutation in ${f}`)
  }

  console.log(`[assisted-import:test] ${passed} assertions passed`)
}

try {
  main()
} catch (e) {
  console.error("ASSISTED IMPORT TEST FAILED:", e instanceof Error ? e.message : e)
  process.exit(1)
}
