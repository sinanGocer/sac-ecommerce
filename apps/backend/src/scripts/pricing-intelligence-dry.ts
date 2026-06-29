import { promises as fs } from "fs"
import path from "path"

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  CompetitorOffer,
  resolveAutomationMode,
  SafePriceInputs,
} from "../pricing-intelligence/pricing-policy"
import { planPricing, PricingProductInput } from "../pricing-intelligence/pricing-service"
import { buildPricingReport } from "../pricing-intelligence/pricing-report"

/**
 * Competitive Pricing — DRY-RUN ONLY.
 *
 * Mevcut yayınlanmış ürünler için fiyat önerisi ALTYAPISINI çalıştırır. GERÇEK
 * fiyat mutation YAPMAZ (db_writes=0). Rakip teklif kaynağı bu fazda BAĞLI
 * DEĞİL (resmi feed/izinli kaynak gelmedi) → her ürün için 0 öneri; karar
 * PRICING_NO_COMPETITOR_SOURCE.
 *
 * Maliyet verisi yok; minimum_safe_price için env tabanlı VARSAYIMLAR kullanılır
 * (yalnız altyapı gösterimi; gerçek karar için gerçek maliyet bağlanmalı).
 */

const REPORTS_DIR = path.resolve(process.cwd(), "pricing-intelligence-reports")
const LATEST = path.join(REPORTS_DIR, "pricing-intelligence-latest.json")

type QueryGraph = { graph: (a: unknown, o?: unknown) => Promise<{ data?: unknown[] }> }

function num(v: string | undefined, d: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}

export default async function pricingIntelligenceDry({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const startedAt = new Date().toISOString()

  const mode = resolveAutomationMode(process.env.PRICE_AUTOMATION_MODE)
  // Güvenlik: bu fazda commit modu desteklenmez; her zaman dry-run.
  if (mode === "commit") {
    logger.warn(
      "[pricing] commit modu bu fazda DEVRE DIŞI. Dry-run'a düşülüyor; DB fiyat mutation 0."
    )
  }

  // Maliyet/komisyon VARSAYIMLARI (env ile yapılandırılabilir).
  const costRatio = num(process.env.PRICE_ASSUMED_COST_RATIO, 0.55) // liste fiyatının oranı
  const vatRate = num(process.env.PRICE_VAT_RATE, 0.2)
  const commissionRate = num(process.env.PRICE_PAYMENT_COMMISSION_RATE, 0.025)
  const shippingContribution = num(process.env.PRICE_SHIPPING_CONTRIBUTION, 0)
  const platformCost = num(process.env.PRICE_PLATFORM_COST, 10)
  const minProfitRate = num(process.env.PRICE_MIN_PROFIT_RATE, 0.1)
  const minProfitAbs = num(process.env.PRICE_MIN_PROFIT_ABS, 10)

  // Yayınlanmış ürünler + TRY fiyat.
  const { data } = await query.graph({
    entity: "product",
    fields: [
      "id", "title", "status", "metadata",
      "sales_channels.id",
      "variants.id", "variants.prices.amount", "variants.prices.currency_code",
    ],
  })
  const rows = (data ?? []) as any[]
  const published = rows.filter(
    (p) => p.status === "published" && (p.sales_channels ?? []).length > 0
  )

  // Rakip teklif kaynağı: bağlı değil → boş. (Gerçek/izinli feed gelince burada
  // doldurulacak; robots/erişim-kontrolü yasaklı kaynaklar TARANMAZ.)
  const competitorOffersByProduct: Record<string, CompetitorOffer[]> = {}

  const products: PricingProductInput[] = published.map((p) => {
    const tryPrice = (p.variants ?? [])
      .flatMap((v: any) => v.prices ?? [])
      .find((pr: any) => (pr.currency_code || "").toLowerCase() === "try")
    const current = Number(tryPrice?.amount ?? 0)
    const assumedCost = current > 0 ? current * costRatio : 0
    const safe_inputs: SafePriceInputs = {
      unit_cost: assumedCost,
      vat_rate: vatRate,
      payment_commission_rate: commissionRate,
      shipping_contribution: shippingContribution,
      platform_cost: platformCost,
      min_profit_rate: minProfitRate,
      min_profit_abs: minProfitAbs,
    }
    return {
      product_id: p.id,
      title: p.title ?? null,
      current_price: current,
      list_price: current > 0 ? current : null,
      floor_override: null,
      ceiling_override: null,
      safe_inputs,
      offers: competitorOffersByProduct[p.id] ?? [],
      last_change_at: null,
    }
  })

  const plan = planPricing({ products, now: new Date().toISOString(), mode: "dry-run" })
  const finishedAt = new Date().toISOString()
  const runId = `pi_${Date.now().toString(36)}_${plan.plan_fingerprint.slice(0, 8)}`
  const report = buildPricingReport({
    runId, startedAt, finishedAt,
    competitorSource: "none (not wired; access-controlled sources are not crawled)",
    plan,
  })

  await fs.mkdir(REPORTS_DIR, { recursive: true })
  await fs.writeFile(LATEST, JSON.stringify(report, null, 2), "utf-8")

  logger.info("──────────── COMPETITIVE PRICING DRY-RUN ────────────")
  logger.info(`mode=${report.mode} decision=${report.batch_decision} products=${report.product_count}`)
  logger.info(`actual_price_mutations=${report.actual_price_mutations} db_writes=${report.db_writes}`)
  logger.info(`competitor_source=${report.competitor_source}`)
  logger.info(`summary=${JSON.stringify(report.summary)}`)
  logger.info(`plan_fingerprint=${report.plan_fingerprint}`)
  logger.info("Rapor: pricing-intelligence-reports/pricing-intelligence-latest.json")
}
