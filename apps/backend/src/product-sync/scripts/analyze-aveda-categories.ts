import { promises as fs } from "fs"
import path from "path"

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  AvedaProvider,
  DEFAULT_AVEDA_OPTIONS,
} from "../providers/aveda.provider"
import { PricingPolicyService } from "../services/pricing-policy.service"
import { REPORTS_DIR } from "../services/sync.service"
import { MedusaProductTransformer } from "../transformers/medusa-product.transformer"
import {
  MedusaProductDraft,
  PricingDecision,
  SyncLogger,
} from "../types/product-sync.types"

type AnalysisEntry = {
  sourceUrl: string
  externalId: string
  title: string
  originalCategoryPath: string | null
  matchedCategoryPath: string | null
  review: boolean
  reviewReasons: string[]
  metadata: MedusaProductDraft["metadata"] | null
  pricing: PricingDecision | null
  errors: string[]
}

type AnalysisReport = {
  provider: "aveda"
  dryRun: true
  startedAt: string
  finishedAt: string
  totalFound: number
  categoryMatched: number
  review: number
  skip: number
  error: number
  sample: AnalysisEntry[]
  results: AnalysisEntry[]
}

/**
 * Aveda kategori ve metadata analizini dry-run olarak çalıştırır.
 * Ürün create/update yapmaz, Medusa product workflow kullanmaz.
 *
 * ENV:
 *   SYNC_LIMIT=20                 Opsiyonel; verilmezse tüm bulunan ürünler.
 *   SYNC_REQUEST_DELAY_MS=500     Opsiyonel; ürün/listeleme istekleri arası bekleme.
 *   SYNC_MAX_LISTING_PAGES=999    Opsiyonel; tüm kategori/listing sayfaları için yüksek tutulur.
 */
export default async function analyzeAvedaCategories({ container }: ExecArgs) {
  const medusaLogger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const logger: SyncLogger = {
    info: (m) => medusaLogger.info(m),
    warn: (m) => medusaLogger.warn(m),
    error: (m) => medusaLogger.error(m),
  }

  const startedAt = new Date().toISOString()
  const limit = parsePositiveInt(process.env.SYNC_LIMIT)
  const requestDelayMs =
    parsePositiveInt(process.env.SYNC_REQUEST_DELAY_MS) ?? 500
  const maxListingPages =
    parsePositiveInt(process.env.SYNC_MAX_LISTING_PAGES) ?? 999

  logger.info(
    `[analyze:aveda] dry-run başladı. limit=${limit ?? "∞"} requestDelayMs=${requestDelayMs} maxListingPages=${maxListingPages}`
  )
  logger.info("[analyze:aveda] Medusa'ya ürün create/update yapılmayacak.")

  const provider = new AvedaProvider(logger, {
    ...DEFAULT_AVEDA_OPTIONS,
    requestDelayMs,
    maxListingPages,
  })
  const pricing = new PricingPolicyService()
  const transformer = new MedusaProductTransformer()

  const urls = await provider.fetchProductUrls(limit)
  const results: AnalysisEntry[] = []

  for (const url of urls) {
    try {
      const raw = await provider.fetchProduct(url)
      const pricingDecision = pricing.decide(raw)
      const draft = transformer.transform(raw, pricingDecision)
      const metadata = draft.metadata
      const pricingReview = pricingDecision.reviewRequired
      const categoryReview = !draft.categoryPath
      const reviewReasons = [
        ...(pricingReview ? pricingDecision.reasons : []),
        ...(categoryReview ? ["Kategori eşleşmedi."] : []),
      ]
      const review = pricingReview || categoryReview

      results.push({
        sourceUrl: raw.sourceUrl,
        externalId: raw.externalId,
        title: raw.name,
        originalCategoryPath:
          typeof metadata.original_category_path === "string"
            ? metadata.original_category_path
            : null,
        matchedCategoryPath:
          typeof metadata.category_path === "string"
            ? metadata.category_path
            : null,
        review,
        reviewReasons,
        metadata,
        pricing: pricingDecision,
        errors: [],
      })

      logger.info(
        `[analyze:aveda] ✓ ${raw.name} | ${draft.categoryPath ? metadata.category_path : "REVIEW: kategori eşleşmedi"}`
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`[analyze:aveda] ✗ ${url} — ${message}`)
      results.push({
        sourceUrl: url,
        externalId: url,
        title: url,
        originalCategoryPath: null,
        matchedCategoryPath: null,
        review: false,
        reviewReasons: [],
        metadata: null,
        pricing: null,
        errors: [message],
      })
    }
  }

  const report: AnalysisReport = {
    provider: "aveda",
    dryRun: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    totalFound: urls.length,
    categoryMatched: results.filter((r) => r.matchedCategoryPath).length,
    review: results.filter((r) => r.review).length,
    skip: 0,
    error: results.filter((r) => r.errors.length > 0).length,
    sample: results.slice(0, 20),
    results,
  }

  await writeAnalysisReport(report)

  logger.info("──────── AVEDA CATEGORY DRY-RUN RAPORU ────────")
  logger.info(`Toplam bulunan ürün: ${report.totalFound}`)
  logger.info(`Kategori eşleşen: ${report.categoryMatched}`)
  logger.info(`Review: ${report.review}`)
  logger.info(`Skip: ${report.skip}`)
  logger.info(`Error: ${report.error}`)
  logger.info("──────── ÖRNEK 20 EŞLEŞME ────────")

  report.sample.forEach((entry, index) => {
    logger.info(
      `${index + 1}. ${entry.title} | original=${entry.originalCategoryPath ?? "-"} | matched=${entry.matchedCategoryPath ?? "REVIEW"}`
    )
  })
  logger.info(
    "Rapor: sync-reports/aveda-category-analysis-latest.json"
  )
}

const parsePositiveInt = (value: string | undefined): number | null => {
  if (!value) return null
  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

const writeAnalysisReport = async (report: AnalysisReport): Promise<void> => {
  await fs.mkdir(REPORTS_DIR, { recursive: true })
  const json = JSON.stringify(report, null, 2)
  const stamp = report.finishedAt.replace(/[:.]/g, "-")
  await fs.writeFile(
    path.join(REPORTS_DIR, `aveda-category-analysis-${stamp}.json`),
    json,
    "utf-8"
  )
  await fs.writeFile(
    path.join(REPORTS_DIR, "aveda-category-analysis-latest.json"),
    json,
    "utf-8"
  )
}
