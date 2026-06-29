import { promises as fs } from "fs"
import path from "path"

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  aggregateDiscovery,
  compareDiscovery,
  discoverFromHtml,
  toCsv,
} from "../assisted-import/category-discovery"

/**
 * Offline Aveda Category Discovery — DRY-RUN ONLY.
 *
 * Kullanıcının tarayıcıdan kaydettiği kategori/listeleme HTML dosyalarından
 * ürün URL'lerini çıkarır, mevcut katalogla karşılaştırır, sonucu CSV'ye yazar.
 * AĞ İSTEĞİ YOK, DB MUTATION YOK (db_writes=0). Ürün sayfalarına bağlanmaz.
 *
 * Giriş klasörü: DISCOVERY_INPUT_DIR (default: import-input/categories)
 * Çıktı CSV:     import-input/aveda-discovered-products.csv
 */

const DEFAULT_INPUT_DIR = "import-input/categories"
const OUTPUT_CSV = "import-input/aveda-discovered-products.csv"
const REPORTS_DIR = "assisted-import-reports"

type QueryGraph = { graph: (a: unknown, o?: unknown) => Promise<{ data?: unknown[] }> }

export default async function categoryDiscoveryDry({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const startedAt = new Date().toISOString()

  const inputDir = (process.env.DISCOVERY_INPUT_DIR ?? DEFAULT_INPUT_DIR).trim()
  const absDir = path.resolve(process.cwd(), inputDir)

  // .html / .htm dosyalarını oku (alt klasör taranmaz; ağ yok).
  let htmlFiles: string[] = []
  try {
    htmlFiles = (await fs.readdir(absDir)).filter((f) => /\.html?$/i.test(f))
  } catch {
    logger.warn(`[discovery] Giriş klasörü bulunamadı: ${inputDir}. Boş discovery.`)
  }

  const files: Array<{ html: string; source_file: string }> = []
  for (const f of htmlFiles) {
    try {
      const html = await fs.readFile(path.join(absDir, f), "utf-8")
      files.push({ html, source_file: f })
    } catch {
      logger.warn(`[discovery] Dosya okunamadı: ${f}`)
    }
  }

  // Dosya başına bulunan ürün (dosya-içi tekilleştirilmiş) — audit.
  const perFile = files.map((f) => ({
    file: f.source_file,
    found: discoverFromHtml(f.html, f.source_file).links.length,
    rejected: discoverFromHtml(f.html, f.source_file).rejected.length,
  }))

  const agg = aggregateDiscovery(files)

  // Mevcut ürünlerin external_id'leri (read-only).
  const { data } = await query.graph({ entity: "product", fields: ["id", "metadata"] })
  const existingExternalIds = new Set<string>(
    ((data ?? []) as any[])
      .map((p) => (typeof p.metadata?.external_id === "string" ? p.metadata.external_id : null))
      .filter((x): x is string => !!x)
  )

  const cmp = compareDiscovery(agg, existingExternalIds)

  // CSV çıktısı (yalnız geçerli, tekilleştirilmiş ürün linkleri).
  const csv = toCsv(agg.links)
  await fs.mkdir(path.dirname(path.resolve(process.cwd(), OUTPUT_CSV)), { recursive: true })
  await fs.writeFile(path.resolve(process.cwd(), OUTPUT_CSV), csv, "utf-8")

  const finishedAt = new Date().toISOString()
  const report = {
    run_id: `disc_${Date.now().toString(36)}`,
    started_at: startedAt,
    finished_at: finishedAt,
    mode: "dry-run",
    input_dir: inputDir,
    html_files: htmlFiles,
    html_file_count: files.length,
    per_file_counts: perFile,
    discovered_unique_products: agg.links.length,
    duplicate_external_ids: agg.duplicate_external_ids,
    rejected_links: agg.rejected.slice(0, 50),
    rejected_count: agg.rejected.length,
    existing_external_ids: existingExternalIds.size,
    comparison: cmp.summary,
    new_products_sample: cmp.new.slice(0, 20),
    output_csv: OUTPUT_CSV,
    db_writes: 0,
    actual_mutations: 0,
  }
  await fs.mkdir(path.resolve(process.cwd(), REPORTS_DIR), { recursive: true })
  await fs.writeFile(
    path.resolve(process.cwd(), REPORTS_DIR, "category-discovery-latest.json"),
    JSON.stringify(report, null, 2),
    "utf-8"
  )

  logger.info("──────────── AVEDA OFFLINE CATEGORY DISCOVERY ────────────")
  logger.info(`input_dir=${inputDir} html_files=${files.length}`)
  logger.info(`discovered_unique=${agg.links.length} rejected=${agg.rejected.length} db_writes=0`)
  logger.info(`compare(existing/new/duplicate/rejected)=${JSON.stringify(cmp.summary)}`)
  logger.info(`CSV: ${OUTPUT_CSV}`)
  if (files.length === 0) {
    logger.info(
      `Hiç HTML yok. Kategori sayfalarını '${inputDir}/' klasörüne kaydedin (bkz docs/category-discovery-guide.md).`
    )
  }
  logger.info("Rapor: assisted-import-reports/category-discovery-latest.json")
}
