import { promises as fs } from "fs"
import path from "path"

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { normalizeTitle } from "../pricing-intelligence/competitor-matching"
import { detectFormat, parseInput } from "../assisted-import/assisted-import-parse"
import { ExistingProductRef } from "../assisted-import/assisted-import-policy"
import { planAssistedImport } from "../assisted-import/assisted-import-service"
import { buildAssistedImportReport } from "../assisted-import/assisted-import-report"

/**
 * User-Assisted Aveda Import — DRY-RUN ONLY.
 *
 * Kullanıcının sağladığı dosyadan (IMPORT_INPUT_FILE) ürünleri ayrıştırır,
 * mevcut katalogla karşılaştırır ve plan/rapor üretir. Ağ isteği ve DB mutation
 * YOK (db_writes=0). Erişim engeli aşılmaz; veri yalnız dosyadan gelir.
 */

const REPORTS_DIR = path.resolve(process.cwd(), "assisted-import-reports")
const LATEST = path.join(REPORTS_DIR, "assisted-import-latest.json")
const DEFAULT_INPUT = "import-input/aveda-product-urls.example.txt"

type QueryGraph = { graph: (a: unknown, o?: unknown) => Promise<{ data?: unknown[] }> }

export default async function assistedImportDry({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const startedAt = new Date().toISOString()

  if (process.env.ASSISTED_IMPORT_COMMIT === "true") {
    logger.warn(
      "[assisted-import] commit modu bu fazda DEVRE DIŞI. Dry-run'a düşülüyor; DB mutation 0."
    )
  }

  const inputFile = (process.env.IMPORT_INPUT_FILE ?? DEFAULT_INPUT).trim()
  const absInput = path.resolve(process.cwd(), inputFile)
  let content = ""
  try {
    content = await fs.readFile(absInput, "utf-8")
  } catch {
    logger.warn(`[assisted-import] Giriş dosyası okunamadı: ${inputFile}. Boş giriş varsayılıyor.`)
  }
  const format = detectFormat(inputFile)
  const records = content ? parseInput(format, content, path.basename(inputFile)) : []

  // Mevcut ürünler (read-only).
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "metadata"],
  })
  const existing: ExistingProductRef[] = ((data ?? []) as any[]).map((p) => ({
    product_id: p.id,
    external_id: typeof p.metadata?.external_id === "string" ? p.metadata.external_id : null,
    handle: p.handle ?? null,
    normalized_title: normalizeTitle(p.title ?? ""),
    volume: typeof p.metadata?.volume === "string" ? p.metadata.volume : null,
  }))

  const plan = planAssistedImport({ records, existing })
  const finishedAt = new Date().toISOString()
  const runId = `ai_${Date.now().toString(36)}_${plan.plan_fingerprint.slice(0, 8)}`
  const report = buildAssistedImportReport({
    runId, startedAt, finishedAt, inputFile, inputFormat: format,
    existingCount: existing.length, plan,
  })

  await fs.mkdir(REPORTS_DIR, { recursive: true })
  await fs.writeFile(LATEST, JSON.stringify(report, null, 2), "utf-8")

  logger.info("──────────── ASSISTED IMPORT DRY-RUN ────────────")
  logger.info(`input=${inputFile} format=${format} records=${records.length} existing=${existing.length}`)
  logger.info(`decision=${report.final_decision} db_writes=${report.db_writes} actual_mutations=${report.actual_mutations}`)
  logger.info(`summary=${JSON.stringify(report.summary)}`)
  logger.info(`plan_fingerprint=${report.plan_fingerprint}`)
  if (report.commit_command) logger.info(`commit (ÇALIŞTIRILMADI): ${report.commit_command}`)
  logger.info("Rapor: assisted-import-reports/assisted-import-latest.json")
}
