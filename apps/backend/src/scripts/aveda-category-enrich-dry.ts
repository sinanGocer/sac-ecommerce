import { promises as fs } from "fs"
import path from "path"

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { normalizeTitle } from "../pricing-intelligence/competitor-matching"
import {
  enrichFromFiles,
  EnrichedProduct,
  summarizeEnrichment,
  toEnrichedCsv,
} from "../assisted-import/category-enrich"
import { aggregateDiscovery } from "../assisted-import/category-discovery"
import { ExistingProductRef, ImportInputRecord } from "../assisted-import/assisted-import-policy"
import { planAssistedImport } from "../assisted-import/assisted-import-service"

/**
 * Aveda Category Enrichment — DRY-RUN ONLY.
 *
 * Kategori HTML'lerindeki inline catalog-mpp JSON'undan ürün kartlarını çıkarır,
 * mevcut katalogla karşılaştırır, YENİ ürünleri sınıflandırır, enriched CSV
 * üretir ve import_ready olanları assisted-import dry-run'ından geçirir.
 * AĞ İSTEĞİ YOK, DB MUTATION YOK (db_writes=0).
 */

const DEFAULT_INPUT_DIR = "import-input/categories"
const OUTPUT_CSV = "import-input/aveda-new-products-enriched.csv"
const REPORTS_DIR = "assisted-import-reports"

type QueryGraph = { graph: (a: unknown, o?: unknown) => Promise<{ data?: unknown[] }> }

export default async function categoryEnrichDry({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const startedAt = new Date().toISOString()

  const inputDir = (process.env.DISCOVERY_INPUT_DIR ?? DEFAULT_INPUT_DIR).trim()
  const absDir = path.resolve(process.cwd(), inputDir)

  let htmlNames: string[] = []
  try {
    htmlNames = (await fs.readdir(absDir)).filter((f) => /\.html?$/i.test(f))
  } catch {
    logger.warn(`[enrich] Klasör yok: ${inputDir}`)
  }
  const files: Array<{ html: string; source_file: string }> = []
  for (const f of htmlNames) {
    try {
      files.push({ html: await fs.readFile(path.join(absDir, f), "utf-8"), source_file: f })
    } catch { /* atla */ }
  }

  const allEnriched = enrichFromFiles(files)

  // Mevcut external_id'ler (read-only).
  const { data } = await query.graph({ entity: "product", fields: ["id", "title", "handle", "metadata"] })
  const existingRows = (data ?? []) as any[]
  const existingExternalIds = new Set<string>(
    existingRows.map((p) => (typeof p.metadata?.external_id === "string" ? p.metadata.external_id : null)).filter((x): x is string => !!x)
  )
  const existingRefs: ExistingProductRef[] = existingRows.map((p) => ({
    product_id: p.id,
    external_id: typeof p.metadata?.external_id === "string" ? p.metadata.external_id : null,
    handle: p.handle ?? null,
    normalized_title: normalizeTitle(p.title ?? ""),
    volume: typeof p.metadata?.volume === "string" ? p.metadata.volume : null,
  }))

  // Sadece YENİ (mevcut external_id'de olmayan) ürünler.
  const newProducts = allEnriched.filter(
    (e) => !(e.external_id && existingExternalIds.has(e.external_id))
  )
  const existingCount = allEnriched.length - newProducts.length
  const newSummary = summarizeEnrichment(newProducts)

  // Enriched CSV (yeni ürünler).
  const csv = toEnrichedCsv(newProducts)
  await fs.mkdir(path.dirname(path.resolve(process.cwd(), OUTPUT_CSV)), { recursive: true })
  await fs.writeFile(path.resolve(process.cwd(), OUTPUT_CSV), csv, "utf-8")

  // import_ready olanları assisted-import dry-run'ından geçir.
  const importReady = newProducts.filter((e) => e.classification === "import_ready")
  const records: ImportInputRecord[] = importReady.map((e, i) => ({
    source_format: "csv",
    url: e.canonical_url,
    title: e.title,
    price: e.price_try,
    sku: e.sku,
    ean: e.ean,
    images: e.image ? [e.image] : [],
    volume: e.volume,
    html: null,
    ref: `enriched:${e.external_id ?? i}`,
  }))
  const importPlan = planAssistedImport({ records, existing: existingRefs })

  // ── Missing CSV: keşfedilen URL var ama kart verisi yok (cross-link vb.) ──
  const MISSING_CSV = "import-input/aveda-missing-product-input.csv"
  const discovery = aggregateDiscovery(files)
  const enrichedIds = new Set(allEnriched.map((e) => e.external_id).filter((x): x is string => !!x))
  const missing = discovery.links.filter(
    (l) => !enrichedIds.has(l.external_id) && !existingExternalIds.has(l.external_id)
  )
  const missingHeader = "url,external_id,title,price,sku,ean,image,volume,source_file,note"
  const missingRows = missing.map((l) =>
    [l.canonical_url, l.external_id, "", "", "", "", "", "", l.source_file, "fill_from_product_page"]
      .map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v)))
      .join(",")
  )
  await fs.writeFile(
    path.resolve(process.cwd(), MISSING_CSV),
    [missingHeader, ...missingRows].join("\n") + "\n",
    "utf-8"
  )

  const finishedAt = new Date().toISOString()
  const report = {
    run_id: `enr_${Date.now().toString(36)}`,
    started_at: startedAt,
    finished_at: finishedAt,
    mode: "dry-run",
    input_dir: inputDir,
    html_file_count: files.length,
    total_enriched: allEnriched.length,
    existing_matched: existingCount,
    new_products: newProducts.length,
    new_classification: newSummary,
    output_csv: OUTPUT_CSV,
    assisted_import_dry_run: {
      decision: importPlan.decision,
      summary: importPlan.summary,
      plan_fingerprint: importPlan.plan_fingerprint,
      db_writes: importPlan.total_db_writes,
    },
    db_writes: 0,
    actual_mutations: 0,
  }
  await fs.mkdir(path.resolve(process.cwd(), REPORTS_DIR), { recursive: true })
  await fs.writeFile(
    path.resolve(process.cwd(), REPORTS_DIR, "category-enrich-latest.json"),
    JSON.stringify(report, null, 2),
    "utf-8"
  )

  logger.info("──────────── AVEDA CATEGORY ENRICHMENT DRY-RUN ────────────")
  logger.info(`files=${files.length} total_enriched=${allEnriched.length} existing_matched=${existingCount} new=${newProducts.length}`)
  logger.info(`new_classification=${JSON.stringify(newSummary)}`)
  logger.info(`assisted_import: decision=${importPlan.decision} summary=${JSON.stringify(importPlan.summary)} db_writes=${importPlan.total_db_writes}`)
  logger.info(`CSV: ${OUTPUT_CSV}  (db_writes=0)`)
  logger.info(`Missing CSV (kart verisi olmayan ${missing.length} URL): ${MISSING_CSV}`)
  logger.info("Rapor: assisted-import-reports/category-enrich-latest.json")
}
