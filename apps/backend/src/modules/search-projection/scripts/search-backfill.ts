import { promises as fs } from "fs"
import path from "path"

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { buildSearchProjection } from "../projection-builder"
import {
  PRODUCT_GRAPH_FIELDS,
  ProductGraphRow,
  VariantAvailabilityMap,
  toBuilderInput,
} from "../projection-mapper"
import {
  isProjectableStatus,
  PROJECTABLE_PRODUCT_STATUSES,
  PROJECTION_POLICY_VERSION,
} from "../projection-policy"
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

interface SalesChannelRow {
  id: string
  name?: string | null
  is_disabled?: boolean | null
}

interface VariantInventoryLinkRow {
  variant_id?: string | null
  required_quantity?: number | null
  inventory?: {
    location_levels?: Array<{
      location_id?: string | null
      stocked_quantity?: number | string | null
      reserved_quantity?: number | string | null
    }> | null
  } | null
}

interface SalesChannelLocationRow {
  stock_location_id?: string | null
}

type QueryGraph = {
  graph: (args: unknown, options?: unknown) => Promise<{ data?: unknown[] }>
}

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
  const salesChannelId = await resolveSalesChannelId(query)

  const service = container.resolve<SearchProjectionService>(
    SEARCH_PROJECTION_MODULE
  )
  const writer = new ProjectionWriter(service)
  const stockLocationIds = await stockLocationIdsForSalesChannel(
    query,
    salesChannelId
  )
  if (stockLocationIds.size === 0) {
    throw new Error(
      `[search:backfill] Sales channel için stock location bulunamadı: ${salesChannelId}`
    )
  }

  logger.info(
    `[search:backfill] mod=${commit ? "COMMIT" : "DRY-RUN"} batch=${take} limit=${maxItems ?? "∞"} currency=${currency} schema_v=${PROJECTION_SCHEMA_VERSION} sales_channel=${salesChannelId}`
  )

  const missing: Record<string, number> = {
    external_id: 0,
    brand: 0,
    category_ids: 0,
    category_path: 0,
    subcategory: 0,
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
  const metadataVersionDistribution: Record<string, number> = {}
  const inventoryDiagnostics = {
    sales_channel_id: salesChannelId,
    stock_location_count: stockLocationIds.size,
    batches: 0,
    variant_ids_checked: 0,
    availability_entries: 0,
  }
  let createdTotal = 0
  let updatedTotal = 0
  let unchangedTotal = 0
  let deletedTotal = 0
  let projectableTotal = 0
  let skippedNonProjectable = 0
  let dbWritesTotal = 0
  let skip = 0
  const statusDistribution: Record<string, number> = {}
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

    // MERKEZİ POLİTİKA: yalnız `published` ürünler projeksiyona girer; diğerleri
    // (draft/proposed/rejected) projeksiyon dışıdır ve mevcut projection'ları
    // targeted delete ile kaldırılır (stale cleanup).
    const projectableRows = rows.filter((row) => isProjectableStatus(row.status))
    const nonProjectableRows = rows.filter(
      (row) => !isProjectableStatus(row.status)
    )
    const removableProductIds = nonProjectableRows.map((row) => row.id)

    for (const row of rows) {
      const statusKey = row.status ?? "unknown"
      statusDistribution[statusKey] = (statusDistribution[statusKey] ?? 0) + 1
    }

    const variantIds = variantIdsFromRows(projectableRows)
    const availabilityByVariantId = await buildVariantAvailabilityMap(
      query,
      variantIds,
      stockLocationIds
    )
    inventoryDiagnostics.batches++
    inventoryDiagnostics.variant_ids_checked += variantIds.length
    inventoryDiagnostics.availability_entries += availabilityByVariantId.size

    const batchProjections: SearchProjection[] = []

    for (const row of projectableRows) {
      const projection = buildSearchProjection(
        toBuilderInput(row, availabilityByVariantId),
        { currency }
      )
      batchProjections.push(projection)

      projectableTotal++
      if (projection.price !== null) withPrice++
      if (projection.in_stock) inStock++

      if (projection.external_id === null) missing.external_id++
      if (projection.brand === null) missing.brand++
      if (projection.category_ids.length === 0) missing.category_ids++
      if (projection.category_path === null) missing.category_path++
      if (projection.subcategory === null) missing.subcategory++
      if (projection.hair_type.length === 0) missing.hair_type++
      if (projection.concerns.length === 0) missing.concerns++
      if (projection.benefits.length === 0) missing.benefits++
      if (projection.size_ml === null) missing.size_ml++
      if (projection.vegan === null) missing.vegan++
      if (projection.color_safe === null) missing.color_safe++
      if (projection.price === null) missing.price++
      if (projection.thumbnail === null) missing.thumbnail++
      const metadataVersion = String(projection.metadata_version)
      metadataVersionDistribution[metadataVersion] =
        (metadataVersionDistribution[metadataVersion] ?? 0) + 1

      if (sample.length < 3) sample.push(projection)
    }

    processed += rows.length
    skippedNonProjectable += nonProjectableRows.length

    const res = await writer.syncBatch(batchProjections, removableProductIds, {
      dryRun: !commit,
    })
    createdTotal += res.created
    updatedTotal += res.updated
    unchangedTotal += res.unchanged
    deletedTotal += res.deleted
    dbWritesTotal += res.db_writes

    skip += rows.length
    logger.info(
      `[search:backfill] İşlenen: ${processed} (projectable=${projectableTotal} skip_non_projectable=${skippedNonProjectable} create=${createdTotal} update=${updatedTotal} unchanged=${unchangedTotal} deleted=${deletedTotal}) ...`
    )

    if (rows.length < take) break
    if (maxItems !== null && processed >= maxItems) break
  }

  const report = {
    mode: commit ? ("commit" as const) : ("dry-run" as const),
    wrote_to_db: dbWritesTotal > 0,
    generatedAt: new Date().toISOString(),
    currency,
    batch_size: take,
    limit: maxItems,
    projection_schema_version: PROJECTION_SCHEMA_VERSION,
    projection_policy_version: PROJECTION_POLICY_VERSION,
    projectable_statuses: [...PROJECTABLE_PRODUCT_STATUSES],
    totals: {
      processed,
      projectable: projectableTotal,
      skipped_non_projectable: skippedNonProjectable,
      with_price: withPrice,
      without_price: projectableTotal - withPrice,
      in_stock: inStock,
      out_of_stock: projectableTotal - inStock,
      created: createdTotal,
      updated: updatedTotal,
      unchanged: unchangedTotal,
      deleted: deletedTotal,
      failed: 0,
      db_writes: dbWritesTotal,
    },
    status_distribution: statusDistribution,
    metadata_version_distribution: metadataVersionDistribution,
    inventory_availability: inventoryDiagnostics,
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
    `mod=${commit ? "COMMIT" : "DRY-RUN"} | taranan: ${processed} | projectable: ${projectableTotal} | non-projectable skip: ${skippedNonProjectable} | create=${createdTotal} update=${updatedTotal} unchanged=${unchangedTotal} deleted=${deletedTotal} | DB'ye yazıldı: ${dbWritesTotal > 0 ? `EVET (${dbWritesTotal})` : "HAYIR"}`
  )
  logger.info(`Rapor: search-reports/search-backfill-latest.json`)
}

function variantIdsFromRows(rows: ProductGraphRow[]): string[] {
  const ids = new Set<string>()
  for (const row of rows) {
    for (const variant of row.variants ?? []) {
      if (typeof variant.id === "string" && variant.id.length > 0) {
        ids.add(variant.id)
      }
    }
  }
  return [...ids]
}

async function resolveSalesChannelId(query: {
  graph: (args: unknown, options?: unknown) => Promise<{ data?: unknown[] }>
}): Promise<string> {
  const configured = process.env.SEARCH_SALES_CHANNEL_ID?.trim()
  if (configured) return configured

  const result = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name", "is_disabled"],
  })
  const channels = ((result.data ?? []) as SalesChannelRow[]).filter(
    (channel) => channel.is_disabled !== true
  )

  if (channels.length === 1) return channels[0].id

  throw new Error(
    `[search:backfill] Sales channel seçilemedi. SEARCH_SALES_CHANNEL_ID verin veya tek aktif sales channel bırakın; yanlış stok pozitifliği üretmemek için dry-run durduruldu. active_sales_channels=${channels.length}`
  )
}

async function buildVariantAvailabilityMap(
  query: QueryGraph,
  variantIds: string[],
  locationIds: Set<string>
): Promise<VariantAvailabilityMap> {
  const availability = new Map<string, boolean>()
  if (variantIds.length === 0) return availability

  const result = await query.graph(
    {
      entity: "product_variant_inventory_items",
      fields: [
        "variant_id",
        "required_quantity",
        "inventory.location_levels.location_id",
        "inventory.location_levels.stocked_quantity",
        "inventory.location_levels.reserved_quantity",
      ],
      filters: { variant_id: variantIds },
    },
    { cache: { enable: true } }
  )

  const linksByVariantId = new Map<string, VariantInventoryLinkRow[]>()
  for (const link of (result.data ?? []) as VariantInventoryLinkRow[]) {
    if (typeof link.variant_id !== "string") continue
    const links = linksByVariantId.get(link.variant_id) ?? []
    links.push(link)
    linksByVariantId.set(link.variant_id, links)
  }

  for (const variantId of variantIds) {
    const links = linksByVariantId.get(variantId) ?? []
    availability.set(variantId, variantCapacity(links, locationIds) > 0)
  }

  return availability
}

async function stockLocationIdsForSalesChannel(
  query: QueryGraph,
  salesChannelId: string
): Promise<Set<string>> {
  const result = await query.graph(
    {
      entity: "sales_channel_locations",
      fields: ["stock_location_id"],
      filters: { sales_channel_id: salesChannelId },
    },
    {
      cache: {
        tags: [`SalesChannel:${salesChannelId}`, "StockLocation:list:*"],
      },
    }
  )

  return new Set(
    ((result.data ?? []) as SalesChannelLocationRow[])
      .map((row) => row.stock_location_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  )
}

function variantCapacity(
  links: VariantInventoryLinkRow[],
  locationIds: Set<string>
): number {
  if (links.length === 0) return 0

  let capacity: number | null = null
  for (const link of links) {
    const requiredQuantity = toPositiveNumber(link.required_quantity)
    if (requiredQuantity === null) return 0

    const available = (link.inventory?.location_levels ?? []).reduce(
      (sum, level) => {
        const locationId = level.location_id
        if (typeof locationId !== "string" || !locationIds.has(locationId)) {
          return sum
        }
        const stocked = toNumber(level.stocked_quantity) ?? 0
        const reserved = toNumber(level.reserved_quantity) ?? 0
        return sum + Math.max(0, stocked - reserved)
      },
      0
    )
    const itemCapacity = Math.floor(available / requiredQuantity)
    capacity = capacity === null ? itemCapacity : Math.min(capacity, itemCapacity)
  }

  return capacity ?? 0
}

function toPositiveNumber(value: unknown): number | null {
  const n = toNumber(value)
  return n !== null && n > 0 ? n : null
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number.parseFloat(value)
    if (Number.isFinite(n)) return n
  }
  return null
}
