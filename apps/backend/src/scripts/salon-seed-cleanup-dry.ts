import { promises as fs } from "fs"
import path from "path"

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { collectSalonSeedState } from "../salon-seed-cleanup/salon-seed-cleanup-collect"
import { buildSalonSeedCleanupReport } from "../salon-seed-cleanup/salon-seed-cleanup-report"
import { planSalonSeedCleanup } from "../salon-seed-cleanup/salon-seed-cleanup-service"

/**
 * Salon Seed Cleanup — DRY-RUN ONLY.
 *
 * Produces an allowlisted cleanup plan for the five local salon seed demo
 * products. It does not call product workflows, projection writers, or any DB
 * mutation path. Snapshot + reference classification come from the shared
 * read-only collector (same source the commit runner uses).
 */

const REPORTS_DIR = path.resolve(process.cwd(), "salon-seed-cleanup-reports")
const LATEST_REPORT = path.join(REPORTS_DIR, "salon-seed-cleanup-latest.json")

export default async function salonSeedCleanupDry({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const startedAt = new Date().toISOString()

  const { snapshots, countsByProductId } = await collectSalonSeedState(container)

  const plan = planSalonSeedCleanup({ snapshots, countsByProductId })
  const finishedAt = new Date().toISOString()
  const runId = `ssc_${Date.now().toString(36)}_${(plan.plan_fingerprint ?? "noplan").slice(0, 8)}`
  const report = buildSalonSeedCleanupReport({
    runId,
    startedAt,
    finishedAt,
    snapshots,
    countsByProductId,
    plan,
  })

  await writeReport(report)
  logSummary(logger, report)
}

async function writeReport(report: ReturnType<typeof buildSalonSeedCleanupReport>): Promise<void> {
  await fs.mkdir(REPORTS_DIR, { recursive: true })
  const stamp = report.finished_at.replace(/[:.]/g, "-")
  const fp = report.plan_fingerprint ?? "noplan"
  const json = JSON.stringify(report, null, 2)
  await fs.writeFile(
    path.join(REPORTS_DIR, `salon-seed-cleanup-${stamp}-${fp}.json`),
    json,
    "utf-8"
  )
  await fs.writeFile(LATEST_REPORT, json, "utf-8")
}

function logSummary(
  logger: { info: (m: string) => void; warn: (m: string) => void },
  report: ReturnType<typeof buildSalonSeedCleanupReport>
): void {
  logger.info("──────────── SALON SEED CLEANUP DRY-RUN ────────────")
  logger.info(
    `decision=${report.final_decision} matched=${report.matched_product_ids.length} missing=${report.missing_product_ids.length} db_writes=${report.db_writes}`
  )
  logger.info(
    `reference_gate=${report.reference_gate.ok ? "ok" : "blocked"} blocked=${report.reference_gate.blocked_product_ids.join(",") || "-"}`
  )
  logger.info(`plan_fingerprint=${report.plan_fingerprint ?? "-"}`)
  for (const action of report.planned_actions) {
    logger.info(
      `  - ${action.product_id} ${action.action}: status=${action.status} executed=${action.executed} db_writes=${action.db_writes}`
    )
  }
  if (report.errors.length > 0) {
    report.errors.forEach((error) => logger.warn(`[salon-seed:cleanup] ${error}`))
  }
  logger.info("Rapor: salon-seed-cleanup-reports/salon-seed-cleanup-latest.json")
}
