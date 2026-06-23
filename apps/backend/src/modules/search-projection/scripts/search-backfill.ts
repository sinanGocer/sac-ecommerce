import { promises as fs } from "fs"
import path from "path"

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { buildSearchProjection } from "../projection-builder"
import {
  PRODUCT_GRAPH_FIELDS,
  ProductGraphRow,
  toBuilderInput,
} from "../projection-mapper"
import { PROJECTION_SCHEMA_VERSION, SearchProjection } from "../search-projection.types"
import { ProjectionWriter } from "../services/projection-writer"
import SearchProjectionService from "../service"
import { SEARCH_PROJECTION_MODULE } from ".."

/**
 * Search Projection — BACKFILL
 * ============================
 * Ürünleri batch'ler halinde OKUR ve projection üretir.
 *
 * VARSAYILAN: DRY-RUN — DB'ye YAZMAZ, yalnız istatistik raporu üretir.
 * YAZMA: yalnızca SEARCH_COMMIT=true verildiğinde ProjectionWriter ile upsert eder.
 *
 * Idempotent: product_id varsa update, yoksa create. Batch başına tek liste
 * sorgusu (N+1 yok). RAW SQL yok; SearchProjectionService kullanılır.
 *
 * Kullanım:
 *   npm run search:backfill:dry              # yazmaz
 *   SEARCH_LIMIT=5 npm run search:backfill   # SEARCH_COMMIT=true ile gerçek upsert
 *   SEARCH_BATCH=100 SEARCH_CURRENCY=try ...
 */

const SEARCH_REPORTS_DIR = path.resolve(process.cwd(), "search-reports")

export default async function searchBackfill({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const commit = process.env.SEARCH_COMMIT === "true"
  const currency = (process.env.SEARCH_CURRENCY ?? "try").toLowerCase()
  const batchEnv = process.env.SEARCH_BATCH
  const parsedBatch = batchEnv ? parseInt(batchEnv, 10) : NaN
  const take = Number.isFinite(parsedBatch) && parsedBatch > 0 ? parsedBatch : 200
  const limitEnv = process.env.SEARCH_LIMIT
  const parsedLimit = limitEnv ? parseInt(limitEnv, 10) : NaN
  const maxItems =
    Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null

  let writer: ProjectionWriter | null = null
  if (commit) {
    const service = container.resolve<SearchProjectionService>(
      SEARCH_PROJECTION_MODULE
    )
    writer = new ProjectionWriter(service)
  }

  logger.info(
    `[search:backfill] mod=${commit ? "COMMIT" : "DRY-RUN"} batch=${take} limit=${maxItems ?? "∞"} currency=${currency} schema_v=${PROJECTION_SCHEMA_VERSION}`
  )

  const missing: Record<string, number> = {
    external_id: 0,
    brand: 0,
    category_ids: 0,
    category_path: 0,
    hair_type: 0,
    concerns: 0,
    benefits: 0,
    size_ml: 0,
    vegan: 0,
    color_safe: 0,
    price: 0,
    thumbnail: 0,
  }

  let processed = 0
  let withPrice = 0
  let inStock = 0
  let createdTotal = 0
  let updatedTotal = 0
  let skip = 0
  const sample: SearchProjection[] = []

  // Batch döngüsü — tüm ürünleri tek seferde belleğe ALMAZ (N+1 yok)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await query.graph({
      entity: "product",
      fields: [...PRODUCT_GRAPH_FIELDS],
      pagination: { skip, take },
    })
    const rows = (result.data ?? []) as ProductGraphRow[]
    if (rows.length === 0) break

    const batchProjections: SearchProjection[] = []

    for (const row of rows) {
      const projection = buildSearchProjection(toBuilderInput(row), { currency })
      batchProjections.push(projection)

      processed++
      if (projection.price !== null) withPrice++
      if (projection.in_stock) inStock++

      if (projection.external_id === null) missing.external_id++
      if (projection.brand === null) missing.brand++
      if (projection.category_ids.length === 0) missing.category_ids++
      if (projection.category_path === null) missing.category_path++
      if (projection.hair_type.length === 0) missing.hair_type++
      if (projection.concerns.length === 0) missing.concerns++
      if (projection.benefits.length === 0) missing.benefits++
      if (projection.size_ml === null) missing.size_ml++
      if (projection.vegan === null) missing.vegan++
      if (projection.color_safe === null) missing.color_safe++
      if (projection.price === null) missing.price++
      if (projection.thumbnail === null) missing.thumbnail++

      if (sample.length < 3) sample.push(projection)
    }

    // Yalnızca COMMIT modunda yaz
    if (writer) {
      const res = await writer.upsertBatch(batchProjections)
      createdTotal += res.created
      updatedTotal += res.updated
    }

    skip += rows.length
    logger.info(
      `[search:backfill] İşlenen: ${processed}${commit ? ` (create=${createdTotal} update=${updatedTotal})` : ""} ...`
    )

    if (rows.length < take) break
    if (maxItems !== null && processed >= maxItems) break
  }

  const report = {
    mode: commit ? ("commit" as const) : ("dry-run" as const),
    wrote_to_db: commit,
    generatedAt: new Date().toISOString(),
    currency,
    batch_size: take,
    limit: maxItems,
    projection_schema_version: PROJECTION_SCHEMA_VERSION,
    totals: {
      processed,
      with_price: withPrice,
      without_price: processed - withPrice,
      in_stock: inStock,
      out_of_stock: processed - inStock,
      created: createdTotal,
      updated: updatedTotal,
    },
    missing_or_empty_fields: missing,
    no_source_fields: [
      "average_rating",
      "review_count",
      "weekly_sales_score",
      "monthly_sales_score",
      "all_time_sales_score",
      "favorite_score",
      "trending_score",
    ],
    sample,
  }

  await fs.mkdir(SEARCH_REPORTS_DIR, { recursive: true })
  const stamp = report.generatedAt.replace(/[:.]/g, "-")
  const file = path.join(SEARCH_REPORTS_DIR, `search-backfill-${stamp}.json`)
  const latest = path.join(SEARCH_REPORTS_DIR, `search-backfill-latest.json`)
  const json = JSON.stringify(report, null, 2)
  await fs.writeFile(file, json, "utf-8")
  await fs.writeFile(latest, json, "utf-8")

  logger.info("──────────── ÖZET ────────────")
  logger.info(
    `mod=${commit ? "COMMIT" : "DRY-RUN"} | işlenen: ${processed} | fiyatlı: ${withPrice} | stokta: ${inStock} | DB'ye yazıldı: ${commit ? `EVET (create=${createdTotal}, update=${updatedTotal})` : "HAYIR"}`
  )
  logger.info(`Rapor: search-reports/search-backfill-latest.json`)
}
