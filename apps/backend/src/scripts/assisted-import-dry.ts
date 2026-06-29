import { promises as fs } from "fs"
import path from "path"

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, ProductStatus } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"

import { normalizeTitle } from "../pricing-intelligence/competitor-matching"
import { detectFormat, parseInput } from "../assisted-import/assisted-import-parse"
import {
  ExistingProductRef,
  ImportInputRecord,
  PlannedImportItem,
  PROTECTED_HANDLES,
  PROTECTED_PRODUCT_IDS,
} from "../assisted-import/assisted-import-policy"
import { planAssistedImport } from "../assisted-import/assisted-import-service"
import { buildAssistedImportReport } from "../assisted-import/assisted-import-report"
import { isImportCommitConfirmationValid } from "../assisted-import/assisted-import-fingerprint"
import { CategoryMappingService } from "../product-sync/services/category-mapping.service"
import { RawProduct, SyncLogger } from "../product-sync/types/product-sync.types"
import { ProductCatalogCategoryService } from "../product-catalog/services/product-catalog-category.service"
import { AVEDA_PRODUCT_CATALOG_TREE } from "../product-catalog/architecture"
import { SEARCH_PROJECTION_MODULE } from "../modules/search-projection"
import SearchProjectionService from "../modules/search-projection/service"
import {
  PRODUCT_GRAPH_FIELDS,
  ProductGraphRow,
  toBuilderInput,
} from "../modules/search-projection/projection-mapper"
import { buildSearchProjection } from "../modules/search-projection/projection-builder"
import { ProjectionWriter } from "../modules/search-projection/services/projection-writer"

/**
 * User-Assisted Aveda Import — dry-run first, commit only with fingerprint.
 *
 * Kullanıcının sağladığı dosyadan (IMPORT_INPUT_FILE) ürünleri ayrıştırır,
 * mevcut katalogla karşılaştırır ve plan/rapor üretir. Commit modunda yalnız
 * fingerprint'i doğrulanan import_ready + new allowlist create edilir.
 */

const REPORTS_DIR = path.resolve(process.cwd(), "assisted-import-reports")
const LATEST = path.join(REPORTS_DIR, "assisted-import-latest.json")
const DEFAULT_INPUT = "import-input/aveda-product-urls.example.txt"

type QueryGraph = { graph: (a: unknown, o?: unknown) => Promise<{ data?: unknown[] }> }
type Logger = SyncLogger

const REQUIRED_IMPORT_READY_COUNT = 35
const PROTECTED_ID_SET = new Set(PROTECTED_PRODUCT_IDS)
const PROTECTED_HANDLE_SET = new Set(PROTECTED_HANDLES)

function importReadyRecords(records: ImportInputRecord[]): ImportInputRecord[] {
  const hasClassification = records.some((record) => record.classification)
  return hasClassification
    ? records.filter((record) => record.classification === "import_ready")
    : records
}

function validateInputShape(records: ImportInputRecord[]) {
  const errors: string[] = []
  if (records.length !== REQUIRED_IMPORT_READY_COUNT) {
    errors.push(`expected_${REQUIRED_IMPORT_READY_COUNT}_import_ready_records_got_${records.length}`)
  }

  const seen = new Set<string>()
  for (const record of records) {
    const parts = record.url ? new URL(record.url).pathname.split("/").filter(Boolean) : []
    const productIdx = parts.indexOf("product")
    const externalId = productIdx >= 0 ? parts[productIdx + 2] : null
    if (!externalId) errors.push(`${record.ref}:missing_external_id`)
    if (externalId && seen.has(externalId)) errors.push(`${record.ref}:duplicate_external_id`)
    if (externalId) seen.add(externalId)
    if (!record.title) errors.push(`${record.ref}:missing_title`)
    if (!record.price || record.price <= 0) errors.push(`${record.ref}:missing_try_price`)
    if (!record.images?.[0]) errors.push(`${record.ref}:missing_image`)
    if (!record.volume) errors.push(`${record.ref}:missing_volume`)
  }

  return errors
}

function failClosed(message: string): never {
  throw new Error(`[assisted-import] Fail-closed: ${message}`)
}

function categoryPartsFromUrl(url: string | null): { category: string | null; subCategory: string | null } {
  if (!url) return { category: null, subCategory: null }
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean)
    const idx = parts.indexOf("product")
    return {
      category: idx >= 0 ? parts[idx + 3] ?? null : null,
      subCategory: idx >= 0 ? parts[idx + 4] ?? null : null,
    }
  } catch {
    return { category: null, subCategory: null }
  }
}

function rawProductFromItem(item: PlannedImportItem): RawProduct {
  if (!item.external_id || !item.canonical_url || !item.title || !item.price_try || !item.images[0] || !item.volume) {
    failClosed(`Eksik import alanı: ${item.ref}`)
  }
  const parts = categoryPartsFromUrl(item.canonical_url)
  return {
    sourceUrl: item.canonical_url,
    externalId: item.external_id,
    name: item.title,
    brand: "Aveda",
    category: item.source_category || parts.category,
    subCategory: parts.subCategory,
    listPrice: item.price_try,
    currentPrice: item.price_try,
    salePrice: null,
    discountRate: null,
    currency: "try",
    images: item.images,
    shortDescription: null,
    longDescription: null,
    usage: null,
    ingredients: null,
    volume: item.volume,
    variants: [{
      title: item.volume,
      sku: item.sku,
      volume: item.volume,
      listPrice: item.price_try,
      salePrice: null,
    }],
    sku: item.sku,
    stockStatus: "in_stock",
    warnings: [],
  }
}

function slugify(input: string): string {
  const map: Record<string, string> = {
    ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u",
    Ç: "c", Ğ: "g", İ: "i", Ö: "o", Ş: "s", Ü: "u",
  }
  return input
    .replace(/[çğıöşüÇĞİÖŞÜ]/g, (ch) => map[ch] ?? ch)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
}

async function resolveExisting(query: QueryGraph): Promise<ExistingProductRef[]> {
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "metadata"],
  })

  return ((data ?? []) as any[]).map((p) => ({
    product_id: p.id,
    external_id: typeof p.metadata?.external_id === "string" ? p.metadata.external_id : null,
    handle: p.handle ?? null,
    normalized_title: normalizeTitle(p.title ?? ""),
    volume: typeof p.metadata?.volume === "string" ? p.metadata.volume : null,
  }))
}

function blockingSummary(plan: ReturnType<typeof planAssistedImport>) {
  return (
    (plan.summary.duplicate ?? 0) +
    (plan.summary.quarantine ?? 0) +
    (plan.summary.missing_data ?? 0) +
    (plan.summary.protected_skip ?? 0) +
    (plan.summary.rejected_url ?? 0)
  )
}

async function commitNewProducts(params: {
  container: ExecArgs["container"]
  logger: Logger
  query: QueryGraph
  items: PlannedImportItem[]
}) {
  const { container, logger, query, items } = params
  const { data: salesChannels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
  })
  const defaultSalesChannel = (salesChannels as any[]).find(
    (channel) => channel.name === "Default Sales Channel"
  )
  if (!defaultSalesChannel) failClosed("Default Sales Channel bulunamadı")

  const { data: shippingProfiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
  })
  const shippingProfile = (shippingProfiles as any[])[0]
  if (!shippingProfile) failClosed("shipping_profile bulunamadı")

  const categoryService = new ProductCatalogCategoryService(container, logger)
  const categoryResult = await categoryService.ensureTree(AVEDA_PRODUCT_CATALOG_TREE)
  const categories = new CategoryMappingService()

  const products = items.map((item) => {
    const raw = rawProductFromItem(item)
    const categoryPath = categories.resolve(raw)
    const metadata = categories.buildMetadata(raw)
    const categoryId = categoryPath
      ? categoryResult.idByExternalId.get(categoryPath.externalId) ?? null
      : null
    const variantTitle = raw.volume ?? "Standart"

    return {
      title: raw.name,
      handle: slugify(new URL(raw.sourceUrl).pathname.split("/").filter(Boolean).at(-1) ?? raw.name),
      description: raw.shortDescription ?? undefined,
      images: raw.images.map((url) => ({ url })),
      thumbnail: raw.images[0],
      status: ProductStatus.PUBLISHED,
      external_id: raw.externalId,
      category_ids: categoryId ? [categoryId] : [],
      shipping_profile_id: shippingProfile.id,
      options: [{ title: "Seçenek", values: [variantTitle] }],
      variants: [{
        title: variantTitle,
        sku: raw.sku ?? `AVEDA-${raw.externalId}`,
        options: { "Seçenek": variantTitle },
        prices: [{ amount: raw.listPrice!, currency_code: "try" }],
        manage_inventory: false,
        metadata: {
          sync_provider: "aveda",
          external_id: raw.externalId,
          source_url: raw.sourceUrl,
          sku: raw.sku,
          ean: item.ean,
          volume: raw.volume,
        },
      }],
      sales_channels: [{ id: defaultSalesChannel.id }],
      metadata: {
        ...metadata,
        metadata_version: 2,
        sync_provider: "aveda",
        external_id: raw.externalId,
        source_url: raw.sourceUrl,
        volume: raw.volume,
        sku: raw.sku,
        ean: item.ean,
        stock_status: "in_stock",
        imported_by: "assisted-import",
      },
    }
  })

  const { result } = await createProductsWorkflow(container).run({
    input: { products },
  })

  const createdIds = (result as Array<{ id: string }>).map((product) => product.id)
  if (createdIds.length !== items.length) {
    failClosed(`createProductsWorkflow sonucu eksik: ${createdIds.length}/${items.length}`)
  }

  const { data: rows } = await query.graph({
    entity: "product",
    fields: [...PRODUCT_GRAPH_FIELDS],
    filters: { id: createdIds },
  })
  const productRows = (rows ?? []) as ProductGraphRow[]
  const projections = productRows.map((row) =>
    buildSearchProjection(toBuilderInput(row), { currency: "try" })
  )
  const projectionService = container.resolve<SearchProjectionService>(
    SEARCH_PROJECTION_MODULE
  )
  const projectionResult = await new ProjectionWriter(projectionService).syncBatch(
    projections,
    [],
    { dryRun: false }
  )

  return {
    created: createdIds.length,
    createdIds,
    projectionResult,
    categoryWrites: categoryResult.created.length + categoryResult.updated.length,
  }
}

export default async function assistedImportDry({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const startedAt = new Date().toISOString()

  const commit = process.env.ASSISTED_IMPORT_COMMIT === "true"

  const inputFile = (process.env.IMPORT_INPUT_FILE ?? DEFAULT_INPUT).trim()
  const absInput = path.resolve(process.cwd(), inputFile)
  let content = ""
  try {
    content = await fs.readFile(absInput, "utf-8")
  } catch {
    logger.warn(`[assisted-import] Giriş dosyası okunamadı: ${inputFile}. Boş giriş varsayılıyor.`)
  }
  const format = detectFormat(inputFile)
  const parsedRecords = content ? parseInput(format, content, path.basename(inputFile)) : []
  const records = importReadyRecords(parsedRecords)
  const shapeErrors = validateInputShape(records)
  if (shapeErrors.length > 0) {
    failClosed(shapeErrors.join(", "))
  }

  const existing = await resolveExisting(query)

  const plan = planAssistedImport({ records, existing })
  const blocked = blockingSummary(plan)
  const importableNew = (plan.summary.new ?? 0)
  const matchedExisting = (plan.summary.update ?? 0)
  const protectedMatches = plan.items.filter(
    (item) =>
      (item.matched_product_id && PROTECTED_ID_SET.has(item.matched_product_id)) ||
      (item.canonical_url && PROTECTED_HANDLE_SET.has(new URL(item.canonical_url).pathname.split("/").filter(Boolean).at(-1) ?? ""))
  )

  if (protectedMatches.length > 0) {
    failClosed(`protected kayıt eşleşti: ${protectedMatches.map((item) => item.ref).join(",")}`)
  }

  if (blocked > 0) {
    plan.decision = "ASSISTED_IMPORT_BLOCKED"
  } else if (importableNew === 0 && matchedExisting === REQUIRED_IMPORT_READY_COUNT) {
    plan.decision = "IDEMPOTENT_NOOP"
  } else if (importableNew === REQUIRED_IMPORT_READY_COUNT && matchedExisting === 0) {
    plan.decision = commit ? "ASSISTED_IMPORT_COMMIT_READY" : "ASSISTED_IMPORT_DRY_RUN_READY"
  } else {
    plan.decision = "ASSISTED_IMPORT_BLOCKED"
  }

  let commitStats = {
    created: 0,
    updated: 0,
    failed: 0,
    db_writes: 0,
    projection_writes: 0,
    projection_created: 0,
    projection_updated: 0,
    projection_unchanged: 0,
    category_writes: 0,
  }

  if (commit && plan.decision === "ASSISTED_IMPORT_COMMIT_READY") {
    if (!isImportCommitConfirmationValid(process.env.ASSISTED_IMPORT_CONFIRM, plan.plan_fingerprint)) {
      failClosed(`fingerprint onayı geçersiz; beklenen=${plan.plan_fingerprint}`)
    }

    const newItems = plan.items.filter((item) => item.category === "new")
    const result = await commitNewProducts({
      container,
      logger,
      query,
      items: newItems,
    })
    commitStats = {
      created: result.created,
      updated: 0,
      failed: 0,
      db_writes: result.created + result.projectionResult.db_writes + result.categoryWrites,
      projection_writes: result.projectionResult.db_writes,
      projection_created: result.projectionResult.created,
      projection_updated: result.projectionResult.updated,
      projection_unchanged: result.projectionResult.unchanged,
      category_writes: result.categoryWrites,
    }
  } else if (commit && plan.decision !== "IDEMPOTENT_NOOP") {
    failClosed(`commit için plan uygun değil: decision=${plan.decision} summary=${JSON.stringify(plan.summary)}`)
  }

  const finishedAt = new Date().toISOString()
  const runId = `ai_${Date.now().toString(36)}_${plan.plan_fingerprint.slice(0, 8)}`
  const report = buildAssistedImportReport({
    runId, startedAt, finishedAt, inputFile, inputFormat: format,
    existingCount: existing.length, plan,
  }) as any
  report.mode = commit ? "commit" : "dry-run"
  report.db_writes = commitStats.db_writes
  report.actual_mutations = commitStats.db_writes
  report.commit_stats = commitStats
  report.input_records_total = parsedRecords.length
  report.import_ready_records = records.length

  await fs.mkdir(REPORTS_DIR, { recursive: true })
  await fs.writeFile(LATEST, JSON.stringify(report, null, 2), "utf-8")

  logger.info("──────────── ASSISTED IMPORT ────────────")
  logger.info(`mode=${commit ? "commit" : "dry-run"} input=${inputFile} format=${format} records=${records.length} existing=${existing.length}`)
  logger.info(`decision=${report.final_decision} db_writes=${report.db_writes} actual_mutations=${report.actual_mutations}`)
  logger.info(`summary=${JSON.stringify(report.summary)}`)
  logger.info(`commit_stats=${JSON.stringify(commitStats)}`)
  logger.info(`plan_fingerprint=${report.plan_fingerprint}`)
  if (report.commit_command) logger.info(`commit (ÇALIŞTIRILMADI): ${report.commit_command}`)
  logger.info("Rapor: assisted-import-reports/assisted-import-latest.json")
}
