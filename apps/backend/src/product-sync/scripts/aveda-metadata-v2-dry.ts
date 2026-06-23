import { promises as fs } from "fs"
import path from "path"

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { AvedaMetadataV2Planner } from "../metadata-v2/aveda-metadata-v2-planner.service"

/**
 * Aveda Metadata V2 Enrichment — DRY-RUN.
 *
 * Tek mod: dry-run. Yalnızca mevcut Aveda ürünlerini OKUR, önerilen V2 patch
 * planını üretir ve JSON rapor yazar. HİÇBİR DB write yapmaz, hiçbir ürünü
 * güncellemez, hiçbir create/update workflow çalıştırmaz, fiyat/görsel/varyant
 * alanına dokunmaz.
 *
 * Kaynak modu: offline re-normalization (canlı network fetch yok).
 *
 * Kullanım: npm run product:aveda:metadata-v2:dry
 */

const REPORTS_DIR = path.resolve(process.cwd(), "metadata-v2-reports")

export default async function avedaMetadataV2Dry({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  logger.info(
    "[metadata-v2:dry] DRY-RUN başladı — offline re-normalization, DB write YOK."
  )

  const planner = new AvedaMetadataV2Planner(query)
  const report = await planner.plan()

  await fs.mkdir(REPORTS_DIR, { recursive: true })
  const stamp = report.generatedAt.replace(/[:.]/g, "-")
  const json = JSON.stringify(report, null, 2)
  await fs.writeFile(
    path.join(REPORTS_DIR, `aveda-metadata-v2-${stamp}.json`),
    json,
    "utf-8"
  )
  await fs.writeFile(
    path.join(REPORTS_DIR, "aveda-metadata-v2-latest.json"),
    json,
    "utf-8"
  )

  const t = report.totals
  logger.info("──────────── METADATA V2 DRY-RUN ÖZET ────────────")
  logger.info(
    `processed=${t.processed} ready_for_v2=${t.ready_for_v2} needs_review=${t.needs_review} rejected=${t.rejected}`
  )
  logger.info(
    `identity_conflicts=${t.identity_conflicts} taxonomy_errors=${t.taxonomy_errors} parser_errors=${t.parser_errors} missing_source_data=${t.missing_source_data}`
  )
  logger.info(
    `patches_proposed=${t.patches_proposed} db_writes=${t.db_writes}`
  )
  logger.info("Rapor: metadata-v2-reports/aveda-metadata-v2-latest.json")
}
