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
import {
  evaluateBatchPreconditions,
  evaluateSelection,
  findDuplicateHandles,
  hasBlockingParserError,
} from "../utils/sync-config"

/** Mevcut ürün araması (idempotency). v1'de opsiyonel; sağlanmazsa "create" varsayılır. */
export type FindExistingFn = (
  externalId: string,
  sourceUrl: string
) => Promise<boolean>

/**
 * Batch create: TÜM doğrulanmış create draft'larını TEK workflow çağrısında
 * yazar (atomicity). Dönüş: external_id → oluşturulan ürün id eşlemesi.
 */
export type CommitBatchFn = (
  drafts: MedusaProductDraft[]
) => Promise<Map<string, string>>

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
    commitBatch?: CommitBatchFn
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
    if (options.commit && !options.dryRun && !commitBatch) {
      this.logger.warn(
        "[sync] commit=true istendi ancak Medusa batch yazım fonksiyonu verilmedi. Yalnızca rapor üretilecek."
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
    const commitEnabled = options.commit && !options.dryRun && !!commitBatch
    // create_ready: yazıma hazır (selected + committable + create + fiyatlı).
    const readyPlan = committablePlan.filter(
      (p) => p.action === "create" && p.draft.price !== null
    )
    const createReady = readyPlan.length
    const batchSize = readyPlan.length

    // 2) BATCH COMMIT — yalnız gerçek commit modunda, TEK workflow çağrısı.
    let committedCount = 0
    let workflowCalls = 0
    if (commitEnabled) {
      // Bloklayıcı seçili kayıtlar: review/parser/identity (committable değil,
      // create-only skip DEĞİL). create-only skip güvenli no-op'tur, blok değil.
      const blockingCount = results.filter(
        (r) =>
          r.selected === true &&
          r.selectionReason === "not_committable_review"
      ).length
      const duplicateHandles = findDuplicateHandles(
        readyPlan.map((p) => p.draft.handle)
      )
      // Fail-closed: eksik istenen id / bloklayıcı kayıt / duplicate handle.
      const pre = evaluateBatchPreconditions({
        requestedCount: requestedIds.length,
        matchedCount: matched.size,
        blockingCount,
        duplicateHandles,
      })
      if (!pre.ok) {
        throw new Error(
          `[sync] Fail-closed (precondition_failed: ${pre.reason}). Workflow çağrılmadı, hiçbir ürün yazılmadı.`
        )
      }
      // create_ready=0 → güvenli no-op (ör. idempotent tekrar koşu); workflow yok.
      if (readyPlan.length > 0) {
        // Defense-in-depth: yazımdan hemen önce her draft hâlâ yok mu? (stale_plan)
        if (findExisting) {
          for (const p of readyPlan) {
            const exists = await findExisting(
              p.draft.externalId,
              p.draft.sourceUrl
            )
            if (exists) {
              throw new Error(
                `[sync] Fail-closed (stale_plan): ${p.draft.externalId} artık mevcut. Workflow çağrılmadı.`
              )
            }
          }
        }
        // TEK workflow çağrısı — tüm draft'lar batch. (N ayrı çağrı YOK.)
        const idByExternalId = await commitBatch!(readyPlan.map((p) => p.draft))
        workflowCalls = 1
        for (const p of readyPlan) {
          const id = idByExternalId.get(p.draft.externalId) ?? null
          if (id) {
            p.entry.committed = true
            p.entry.committedId = id
            committedCount++
          } else {
            p.entry.errors.push(
              `[sync] Batch sonucu eşleşmedi (external_id=${p.draft.externalId}).`
            )
          }
        }
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
      createReady,
      batchSize,
      workflowCalls,
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
      createReady: number
      batchSize: number
      workflowCalls: number
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
      create_ready: ctx.createReady,
      batch_size: ctx.batchSize,
      workflow_calls: ctx.workflowCalls,
    }
    for (const r of results) {
      // create-only skip'leri create/update/review'a SAYMA — yalnız kendi
      // sayacına yazılır (idempotent no-op koşusunda update şişmesin).
      if (r.selectionReason === "skipped_existing_create_only") {
        summary.skipped_existing_create_only += 1
      } else if (r.action === "create") summary.create += 1
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
