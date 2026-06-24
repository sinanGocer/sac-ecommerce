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
import { evaluateSelection, hasBlockingParserError } from "../utils/sync-config"

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

    // Pilot allowlist + create-only (env parsing script'te; burada hazır gelir).
    const allowlist =
      options.onlyExternalIds && options.onlyExternalIds.length > 0
        ? new Set(options.onlyExternalIds)
        : null
    const createOnly = options.createOnly === true
    const requestedIds = options.onlyExternalIds ?? []

    const urls = await this.provider.fetchProductUrls(options.limit)
    const discovered = urls.length
    this.logger.info(
      `[sync] keşfedilen=${discovered} allowlist=${allowlist ? [...allowlist].join(",") : "yok"} createOnly=${createOnly}`
    )

    const results: SyncReportEntry[] = []
    const matched = new Set<string>()
    // Commit planı: yalnız seçili + committable ürünler (writer'a yalnız bunlar ulaşır).
    const committablePlan: Array<{
      entry: SyncReportEntry
      draft: MedusaProductDraft
      action: "create" | "update"
    }> = []

    // 1) KEŞİF + PARSE + SINIFLANDIRMA — bu aşamada HİÇBİR commit yapılmaz.
    for (const url of urls) {
      try {
        const raw = await this.provider.fetchProduct(url)
        const pricing: PricingDecision = this.pricing.decide(raw)
        const draft: MedusaProductDraft = this.transformer.transform(
          raw,
          pricing
        )

        // Ayrıştırma/doğrulama hatası → ürün create/update edilmez, review.
        const blocked = hasBlockingParserError(raw.parserErrors)
        const baseAction: SyncAction = blocked
          ? "review"
          : await this.decideAction(draft, pricing, findExisting)

        // Seçim politikası (allowlist + create-only) — tek kaynak.
        const sel = evaluateSelection({
          externalId: draft.externalId,
          action: baseAction,
          allowlist,
          createOnly,
        })
        if (allowlist && sel.selected) matched.add(draft.externalId)

        if (pricing.discountDetected) {
          await PriceChangeStore.upsert(
            this.buildPriceChange(raw.name, draft, pricing)
          )
        }

        const action: SyncAction =
          sel.status === "filtered_not_selected" ? "filtered" : baseAction

        const entry: SyncReportEntry = {
          sourceUrl: url,
          externalId: draft.externalId,
          name: raw.name,
          action,
          pricing,
          draft,
          committed: false,
          committedId: null,
          warnings: raw.warnings,
          errors: [],
          titleSource: raw.titleSource,
          titleVerified: raw.titleVerified,
          priceSource: raw.priceSource,
          priceVerified: raw.priceVerified,
          parserErrors: raw.parserErrors,
          reviewReasons: blocked ? raw.parserErrors : undefined,
          selected: sel.selected,
          selectionReason: sel.status,
        }
        results.push(entry)

        if (sel.committable && (baseAction === "create" || baseAction === "update")) {
          committablePlan.push({ entry, draft, action: baseAction })
        }
        this.logger.info(
          `[sync] • ${raw.name} → ${action} (selected=${sel.selected}, ${sel.status})`
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
          selected: false,
          selectionReason: "fetch_error",
        })
      }
    }

    const missing = requestedIds.filter((id) => !matched.has(id))
    const commitEnabled = options.commit && !options.dryRun && !!commitProduct

    // 2) COMMIT AŞAMASI — yalnız gerçek commit modunda. Fail-closed + ön doğrulama.
    let committedCount = 0
    if (commitEnabled) {
      // Pilot güvenlik: allowlist verildiyse istenen TÜM id'ler eşleşmeli.
      if (allowlist && missing.length > 0) {
        throw new Error(
          `[sync] Fail-closed: istenen external_id'lerden eşleşmeyen var (${missing.join(",")}). Hiçbir ürün yazılmadı.`
        )
      }
      // All-or-nothing ön doğrulama: yazılacakların tamamı fiyatlı olmalı.
      for (const p of committablePlan) {
        if (p.draft.price === null) {
          throw new Error(
            `[sync] Fail-closed: ${p.draft.handle} fiyatsız; toplu yazımdan önce iptal. Hiçbir ürün yazılmadı.`
          )
        }
      }
      // NOT: createProductsWorkflow ürün-başına çağrılır; çapraz-ürün tek
      // transaction GARANTİSİ YOK. Gerçek atomicity için import görevinde
      // tüm draft'lar tek workflow input.products dizisinde batch'lenmeli.
      for (const p of committablePlan) {
        const id = await commitProduct!(p.draft, p.action)
        p.entry.committed = true
        p.entry.committedId = id
        committedCount++
      }
    }

    const report = this.buildReport(startedAt, options, results, {
      discovered,
      createOnly,
      commitEnabled,
      committedCount,
      requested: requestedIds,
      matched,
      missing,
    })
    await this.writeReport(report)

    if (!commitEnabled && missing.length > 0) {
      this.logger.warn(
        `[sync] Eksik istenen external_id (dry-run, yazım yok): ${missing.join(",")}`
      )
    }

    this.logger.info(
      `[sync] Bitti — discovered=${discovered} selected=${report.summary.selected} create=${report.summary.create} update=${report.summary.update} review=${report.summary.review} filtered=${report.summary.filtered_not_selected} committed=${report.summary.committed}`
    )
    return report
  }

  private async decideAction(
    draft: MedusaProductDraft,
    pricing: PricingDecision,
    findExisting?: FindExistingFn
  ): Promise<SyncAction> {
    if (pricing.reviewRequired) {
      return "review"
    }
    if (!draft.categoryPath) {
      return "review"
    }
    if (!findExisting) {
      return "create"
    }
    const exists = await findExisting(draft.externalId, draft.sourceUrl)
    return exists ? "update" : "create"
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
    results: SyncReportEntry[],
    ctx: {
      discovered: number
      createOnly: boolean
      commitEnabled: boolean
      committedCount: number
      requested: string[]
      matched: Set<string>
      missing: string[]
    }
  ): SyncReport {
    const summary = {
      create: 0,
      update: 0,
      skip: 0,
      review: 0,
      errors: 0,
      committed: 0,
      discovered: ctx.discovered,
      processed: results.length,
      selected: 0,
      filtered_not_selected: 0,
      skipped_existing_create_only: 0,
      failed: 0,
      db_writes: ctx.committedCount,
      dry_run: options.dryRun,
      commit_enabled: ctx.commitEnabled,
      create_only: ctx.createOnly,
      requested_external_ids: ctx.requested.length,
      matched_external_ids: ctx.matched.size,
      missing_requested_external_ids: ctx.missing,
    }
    for (const r of results) {
      if (r.action === "create") summary.create += 1
      else if (r.action === "update") summary.update += 1
      else if (r.action === "review") summary.review += 1
      else if (r.action === "skip") summary.skip += 1
      else if (r.action === "filtered") summary.filtered_not_selected += 1
      if (r.errors.length > 0) {
        summary.errors += 1
        summary.failed += 1
      }
      if (r.committed) summary.committed += 1
      if (r.selected === true) summary.selected += 1
      if (r.selectionReason === "skipped_existing_create_only") {
        summary.skipped_existing_create_only += 1
      }
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
