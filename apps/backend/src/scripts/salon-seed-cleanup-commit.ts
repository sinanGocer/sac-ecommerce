import { promises as fs } from "fs"
import path from "path"

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  linkProductsToSalesChannelWorkflow,
  updateProductsWorkflow,
} from "@medusajs/medusa/core-flows"

import { SEARCH_PROJECTION_MODULE } from "../modules/search-projection"
import SearchProjectionService from "../modules/search-projection/service"
import { collectSalonSeedState } from "../salon-seed-cleanup/salon-seed-cleanup-collect"
import { isSalonSeedCommitConfirmationValid } from "../salon-seed-cleanup/salon-seed-cleanup-fingerprint"
import { TARGET_PRODUCT_STATUS } from "../salon-seed-cleanup/salon-seed-cleanup-policy"
import { buildSalonSeedCleanupReport } from "../salon-seed-cleanup/salon-seed-cleanup-report"
import { planSalonSeedCleanup } from "../salon-seed-cleanup/salon-seed-cleanup-service"
import {
  executeSalonSeedCleanup,
  ExecutedSeedAction,
  SeedCleanupMutator,
} from "../salon-seed-cleanup/salon-seed-cleanup-writer"

/**
 * Salon Seed Cleanup — CONTROLLED COMMIT RUNNER.
 *
 * VARSAYILAN: DRY-RUN (DB write 0). Gerçek yazım YALNIZ şu üç koşul birlikte
 * sağlandığında yapılır:
 *   1) SALON_SEED_CLEANUP_COMMIT=true
 *   2) SALON_SEED_CLEANUP_FINGERPRINT=<canlı plan_fingerprint ile birebir eşleşen token>
 *   3) plan kararı SALON_SEED_CLEANUP_DRY_RUN_READY (reference gate her çalışmada
 *      yeniden değerlendirilir)
 *
 * Yanlış/eksik fingerprint veya READY olmayan plan → DB write 0 (fail-closed).
 * Yalnız allowlist'li 5 ürün; aksiyonlar: unpublish + sales-channel detach +
 * projection remove. Hard delete yok, order/cart mutation yok, KVKK yok.
 * Tekrar çalıştırmada hedef durum sağlandığından no-op/idempotent.
 */

const REPORTS_DIR = path.resolve(process.cwd(), "salon-seed-cleanup-reports")
const LATEST_REPORT = path.join(REPORTS_DIR, "salon-seed-cleanup-commit-latest.json")

export default async function salonSeedCleanupCommit({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const startedAt = new Date().toISOString()

  const commitEnabled = process.env.SALON_SEED_CLEANUP_COMMIT === "true"
  const confirmToken = process.env.SALON_SEED_CLEANUP_FINGERPRINT ?? null

  const { snapshots, countsByProductId } = await collectSalonSeedState(container)
  const plan = planSalonSeedCleanup({ snapshots, countsByProductId })

  const planReady = plan.decision === "SALON_SEED_CLEANUP_DRY_RUN_READY"
  const confirmed = isSalonSeedCommitConfirmationValid(confirmToken, plan.plan_fingerprint)
  const shouldCommit = commitEnabled && planReady && confirmed

  let mode: "dry-run" | "commit" = "dry-run"
  let executedActions: ExecutedSeedAction[] = []
  let dbWrites = 0
  let projectionWrites = 0
  let finalDecision = plan.decision

  if (shouldCommit) {
    mode = "commit"
    const result = await executeSalonSeedCleanup(plan, buildMedusaMutator(container))
    executedActions = result.executed_actions
    dbWrites = result.db_writes
    projectionWrites = result.projection_writes
    finalDecision = result.decision
    logger.info(
      `[salon-seed:cleanup] commit yürütüldü — db_writes=${dbWrites} projection_writes=${projectionWrites} decision=${finalDecision}`
    )
  } else if (commitEnabled) {
    // Commit istendi ama guard'lar geçmedi → fail-closed, 0 yazım.
    mode = "commit"
    if (!planReady) {
      logger.warn(
        `[salon-seed:cleanup] Fail-closed: plan READY değil (decision=${plan.decision}). DB write 0.`
      )
    } else if (!confirmToken) {
      logger.warn(
        "[salon-seed:cleanup] Fail-closed: SALON_SEED_CLEANUP_FINGERPRINT verilmedi. DB write 0."
      )
    } else if (!confirmed) {
      logger.warn(
        `[salon-seed:cleanup] Fail-closed: fingerprint eşleşmiyor (beklenen=${plan.plan_fingerprint ?? "-"}, verilen=${confirmToken}). DB write 0.`
      )
    }
  } else {
    logger.info(
      "[salon-seed:cleanup] DRY-RUN (commit kapalı). Gerçek yazım için SALON_SEED_CLEANUP_COMMIT=true + SALON_SEED_CLEANUP_FINGERPRINT gerekir."
    )
  }

  const finishedAt = new Date().toISOString()
  const runId = `sscC_${Date.now().toString(36)}_${(plan.plan_fingerprint ?? "noplan").slice(0, 8)}`
  const report = buildSalonSeedCleanupReport({
    runId,
    startedAt,
    finishedAt,
    snapshots,
    countsByProductId,
    plan,
    mode,
    commitEnabled,
    commitConfirmed: shouldCommit,
    executedActions,
    dbWrites,
    projectionWrites,
    finalDecision,
  })

  await writeReport(report)
  logSummary(logger, report)
}

/** Gerçek Medusa-backed mutator. Yalnız 3 izinli mutation tipini çağırır. */
function buildMedusaMutator(container: ExecArgs["container"]): SeedCleanupMutator {
  return {
    async unpublishProduct(productId: string): Promise<void> {
      await updateProductsWorkflow(container).run({
        input: { selector: { id: productId }, update: { status: TARGET_PRODUCT_STATUS } },
      })
    },
    async detachSalesChannels(productId: string, channelIds: string[]): Promise<void> {
      for (const channelId of channelIds) {
        await linkProductsToSalesChannelWorkflow(container).run({
          input: { id: channelId, remove: [productId] },
        })
      }
    },
    async removeProjection(projectionId: string): Promise<void> {
      const service = container.resolve<SearchProjectionService>(SEARCH_PROJECTION_MODULE)
      await service.deleteProductSearchProjections([projectionId])
    },
  }
}

async function writeReport(report: ReturnType<typeof buildSalonSeedCleanupReport>): Promise<void> {
  await fs.mkdir(REPORTS_DIR, { recursive: true })
  const stamp = report.finished_at.replace(/[:.]/g, "-")
  const fp = report.plan_fingerprint ?? "noplan"
  const json = JSON.stringify(report, null, 2)
  await fs.writeFile(
    path.join(REPORTS_DIR, `salon-seed-cleanup-commit-${stamp}-${fp}.json`),
    json,
    "utf-8"
  )
  await fs.writeFile(LATEST_REPORT, json, "utf-8")
}

function logSummary(
  logger: { info: (m: string) => void; warn: (m: string) => void },
  report: ReturnType<typeof buildSalonSeedCleanupReport>
): void {
  logger.info("──────────── SALON SEED CLEANUP COMMIT ────────────")
  logger.info(
    `mode=${report.mode} commit_enabled=${report.commit_enabled} commit_confirmed=${report.commit_confirmed} decision=${report.final_decision}`
  )
  logger.info(
    `matched=${report.matched_product_ids.length} reference_gate=${report.reference_gate.ok ? "ok" : "blocked"} db_writes=${report.db_writes} projection_writes=${report.projection_writes}`
  )
  logger.info(`plan_fingerprint=${report.plan_fingerprint ?? "-"}`)
  for (const action of report.executed_actions) {
    logger.info(
      `  - ${action.product_id} ${action.action}: status=${action.status} executed=${action.executed} db_writes=${action.db_writes}`
    )
  }
  if (report.errors.length > 0) {
    report.errors.forEach((error) => logger.warn(`[salon-seed:cleanup] ${error}`))
  }
  logger.info("Rapor: salon-seed-cleanup-reports/salon-seed-cleanup-commit-latest.json")
}
