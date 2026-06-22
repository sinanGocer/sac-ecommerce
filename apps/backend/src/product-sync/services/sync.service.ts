import { promises as fs } from "fs"
import path from "path"

import {
  MedusaProductDraft,
  PriceChangeRecord,
  PricingDecision,
  SyncAction,
  SyncLogger,
  SyncProvider,
  SyncReport,
  SyncReportEntry,
  SyncRunOptions,
} from "../types/product-sync.types"
import { PricingPolicyService } from "./pricing-policy.service"
import { MedusaProductTransformer } from "../transformers/medusa-product.transformer"

/** Mevcut ürün araması (idempotency). v1'de opsiyonel; sağlanmazsa "create" varsayılır. */
export type FindExistingFn = (
  externalId: string,
  sourceUrl: string
) => Promise<boolean>

export type CommitProductFn = (
  draft: MedusaProductDraft,
  action: Extract<SyncAction, "create" | "update">
) => Promise<string>

export const REPORTS_DIR = path.resolve(process.cwd(), "sync-reports")
const PRICE_CHANGES_FILE = path.join(REPORTS_DIR, "price-changes.json")

/**
 * Fiyat değişikliği deposu (JSON tabanlı price history / onay kuyruğu).
 * v1'de Medusa'ya yazım kapalı; onay/ret durumları burada tutulur ve
 * yazım açıldığında (v2) Medusa fiyatına uygulanır.
 */
export class PriceChangeStore {
  static async readAll(): Promise<PriceChangeRecord[]> {
    try {
      const buf = await fs.readFile(PRICE_CHANGES_FILE, "utf-8")
      const parsed: unknown = JSON.parse(buf)
      return Array.isArray(parsed) ? (parsed as PriceChangeRecord[]) : []
    } catch {
      return []
    }
  }

  static async writeAll(records: PriceChangeRecord[]): Promise<void> {
    await fs.mkdir(REPORTS_DIR, { recursive: true })
    await fs.writeFile(
      PRICE_CHANGES_FILE,
      JSON.stringify(records, null, 2),
      "utf-8"
    )
  }

  /** Idempotent ekleme/güncelleme: aynı id varsa pending kaydı tazelenir. */
  static async upsert(record: PriceChangeRecord): Promise<void> {
    const all = await this.readAll()
    const idx = all.findIndex((r) => r.id === record.id)
    if (idx === -1) {
      all.push(record)
    } else if (all[idx].status === "pending") {
      all[idx] = { ...all[idx], ...record }
    }
    await this.writeAll(all)
  }

  static async setStatus(
    id: string,
    status: "approved" | "rejected"
  ): Promise<PriceChangeRecord | null> {
    const all = await this.readAll()
    const idx = all.findIndex((r) => r.id === id)
    if (idx === -1) {
      return null
    }
    all[idx] = {
      ...all[idx],
      status,
      resolvedAt: new Date().toISOString(),
    }
    await this.writeAll(all)
    return all[idx]
  }
}

export class SyncService {
  constructor(
    private readonly logger: SyncLogger,
    private readonly provider: SyncProvider,
    private readonly pricing: PricingPolicyService = new PricingPolicyService(),
    private readonly transformer: MedusaProductTransformer = new MedusaProductTransformer()
  ) {}

  /**
   * Senkron koşusunu çalıştırır. dry-run rapor üretir; commit=true + dryRun=false
   * olduğunda çağıranın verdiği Medusa yazım fonksiyonunu kullanır.
   */
  async run(
    options: SyncRunOptions,
    findExisting?: FindExistingFn,
    commitProduct?: CommitProductFn
  ): Promise<SyncReport> {
    const startedAt = new Date().toISOString()
    this.logger.info(
      `[sync] Başladı — provider=${this.provider.name} dryRun=${options.dryRun} limit=${options.limit ?? "∞"}`
    )

    if (options.commit && options.dryRun) {
      this.logger.warn(
        "[sync] commit=true istendi ancak dryRun=true. Yalnızca rapor üretilecek."
      )
    }
    if (options.commit && !options.dryRun && !commitProduct) {
      this.logger.warn(
        "[sync] commit=true istendi ancak Medusa yazım fonksiyonu verilmedi. Yalnızca rapor üretilecek."
      )
    }

    const urls = await this.provider.fetchProductUrls(options.limit)
    this.logger.info(`[sync] ${urls.length} ürün işlenecek.`)

    const results: SyncReportEntry[] = []

    for (const url of urls) {
      try {
        const raw = await this.provider.fetchProduct(url)
        const pricing: PricingDecision = this.pricing.decide(raw)
        const draft: MedusaProductDraft = this.transformer.transform(
          raw,
          pricing
        )

        const action = await this.decideAction(
          draft.externalId,
          draft.sourceUrl,
          pricing,
          findExisting
        )

        // İndirim tespit edildiyse fiyat-değişiklik kaydı (onay kuyruğu) oluştur
        if (pricing.discountDetected) {
          await PriceChangeStore.upsert(
            this.buildPriceChange(raw.name, draft, pricing)
          )
        }

        const commitResult = await this.commitIfEnabled(
          options,
          draft,
          action,
          commitProduct
        )

        results.push({
          sourceUrl: url,
          externalId: draft.externalId,
          name: raw.name,
          action,
          pricing,
          draft,
          committed: commitResult.committed,
          committedId: commitResult.committedId,
          warnings: raw.warnings,
          errors: [],
        })
        this.logger.info(
          `[sync] ✓ ${raw.name} → ${action}${commitResult.committedId ? ` (${commitResult.committedId})` : ""}`
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.logger.error(`[sync] ✗ ${url} — ${message}`)
        results.push({
          sourceUrl: url,
          externalId: url,
          name: url,
          action: "skip",
          pricing: {
            medusaPrice: null,
            discountDetected: false,
            salePrice: null,
            discountRate: null,
            reviewRequired: true,
            marginOk: null,
            reasons: ["Çekme/dönüştürme hatası."],
          },
          draft: null,
          committed: false,
          committedId: null,
          warnings: [],
          errors: [message],
        })
      }
    }

    const report = this.buildReport(startedAt, options, results)
    await this.writeReport(report)

    // NOT (v2): Kaynakta artık görünmeyen ürünler otomatik SİLİNMEZ;
    // commit aşamasında passive/review_required yapılacak.

    this.logger.info(
      `[sync] Bitti — create=${report.summary.create} update=${report.summary.update} review=${report.summary.review} skip=${report.summary.skip} errors=${report.summary.errors}`
    )
    return report
  }

  private async decideAction(
    externalId: string,
    sourceUrl: string,
    pricing: PricingDecision,
    findExisting?: FindExistingFn
  ): Promise<SyncAction> {
    if (pricing.reviewRequired) {
      return "review"
    }
    if (!findExisting) {
      return "create"
    }
    const exists = await findExisting(externalId, sourceUrl)
    return exists ? "update" : "create"
  }

  private async commitIfEnabled(
    options: SyncRunOptions,
    draft: MedusaProductDraft,
    action: SyncAction,
    commitProduct?: CommitProductFn
  ): Promise<{ committed: boolean; committedId: string | null }> {
    if (!options.commit || options.dryRun || !commitProduct) {
      return { committed: false, committedId: null }
    }
    if (action === "review" || action === "skip" || action === "update") {
      return { committed: false, committedId: null }
    }
    const committedId = await commitProduct(draft, action)
    return { committed: true, committedId }
  }

  private buildPriceChange(
    name: string,
    draft: MedusaProductDraft,
    pricing: PricingDecision
  ): PriceChangeRecord {
    return {
      id: `${this.provider.name}_${draft.externalId}_sale_price`,
      provider: this.provider.name,
      externalId: draft.externalId,
      sourceUrl: draft.sourceUrl,
      name,
      field: "sale_price",
      oldValue: pricing.medusaPrice,
      newValue: pricing.salePrice,
      discountRate: pricing.discountRate,
      reviewRequired: pricing.reviewRequired,
      status: "pending",
      detectedAt: new Date().toISOString(),
      resolvedAt: null,
    }
  }

  private buildReport(
    startedAt: string,
    options: SyncRunOptions,
    results: SyncReportEntry[]
  ): SyncReport {
    const summary = {
      create: 0,
      update: 0,
      skip: 0,
      review: 0,
      errors: 0,
      committed: 0,
    }
    for (const r of results) {
      summary[r.action] += 1
      if (r.errors.length > 0) summary.errors += 1
      if (r.committed) summary.committed += 1
    }
    return {
      provider: this.provider.name,
      startedAt,
      finishedAt: new Date().toISOString(),
      dryRun: options.dryRun,
      limit: options.limit,
      total: results.length,
      summary,
      results,
    }
  }

  private async writeReport(report: SyncReport): Promise<void> {
    await fs.mkdir(REPORTS_DIR, { recursive: true })
    const stamp = report.finishedAt.replace(/[:.]/g, "-")
    const file = path.join(REPORTS_DIR, `${report.provider}-${stamp}.json`)
    const latest = path.join(REPORTS_DIR, `${report.provider}-latest.json`)
    const json = JSON.stringify(report, null, 2)
    await fs.writeFile(file, json, "utf-8")
    await fs.writeFile(latest, json, "utf-8")
    this.logger.info(`[sync] Rapor yazıldı: ${file}`)
  }
}
