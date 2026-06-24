import { promises as fs } from "fs"
import path from "path"

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"

import {
  AvedaMetadataV2CommitWriter,
  CurrentProductState,
  resolveCommitGuard,
  verifyCommitScope,
} from "../metadata-v2/metadata-v2-commit"
import { AvedaMetadataV2Planner } from "../metadata-v2/aveda-metadata-v2-planner.service"
import { parseExternalIdAllowlist } from "../utils/sync-config"

const REPORTS_DIR = path.resolve(process.cwd(), "metadata-v2-reports")

interface ProductRow {
  id: string
  handle?: string | null
  metadata?: Record<string, unknown> | null
}

export default async function avedaMetadataV2Commit({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const guard = resolveCommitGuard(process.env)

  if (!guard.commit_enabled || guard.dry_run) {
    throw new Error(
      "[metadata-v2:commit] DB write kilitli. AVEDA_METADATA_V2_COMMIT=true ve AVEDA_METADATA_V2_DRY_RUN=false birlikte gerekli."
    )
  }

  // Scope güvenliği: gerçek commit yalnız açık external_id allowlist ile yapılır.
  // (Dry-run ile birebir hedefleme — eski 5 V2 ve salon-seed kapsam DIŞINDA.)
  // Geçersiz/boş allowlist → parseExternalIdAllowlist açık hata (fail-closed).
  const allowlist = parseExternalIdAllowlist(process.env.SYNC_ONLY_EXTERNAL_IDS)
  if (!allowlist) {
    throw new Error(
      "[metadata-v2:commit] Fail-closed: SYNC_ONLY_EXTERNAL_IDS zorunlu (hedef external_id'ler). Yazım yapılmadı."
    )
  }

  const planner = new AvedaMetadataV2Planner(query, undefined, allowlist)
  const planReport = await planner.plan()

  // Fail-closed scope doğrulaması: istenen TÜM id'ler eşleşmeli; aksi halde
  // writer ÇAĞRILMAZ (DB write 0).
  const scopeCheck = verifyCommitScope(planReport.scope)
  if (!scopeCheck.ok) {
    throw new Error(
      `[metadata-v2:commit] Fail-closed (scope: ${scopeCheck.reason}). Yazım yapılmadı.`
    )
  }
  logger.info(
    `[metadata-v2:commit] scope OK — requested=${planReport.scope?.requested_external_ids} matched=${planReport.scope?.matched_external_ids} (yalnız hedef ürünler).`
  )

  const productIds = planReport.products.map((product) => product.product_id)

  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "handle", "metadata"],
    filters: { id: productIds },
  })
  const currentProducts = new Map<string, CurrentProductState>()
  for (const value of data ?? []) {
    if (!isProductRow(value)) continue
    const row = value
    currentProducts.set(row.id, {
      id: row.id,
      handle: row.handle ?? null,
      metadata: row.metadata ?? {},
    })
  }

  const writer = new AvedaMetadataV2CommitWriter(
    async (productId, mergedMetadata) => {
      await updateProductsWorkflow(container).run({
        input: {
          selector: { id: productId },
          update: { metadata: mergedMetadata },
        },
      })
    }
  )
  const report = await writer.execute(
    planReport.products,
    currentProducts,
    guard
  )

  await fs.mkdir(REPORTS_DIR, { recursive: true })
  const stamp = report.generatedAt.replace(/[:.]/g, "-")
  const json = JSON.stringify(report, null, 2)
  await fs.writeFile(
    path.join(REPORTS_DIR, `aveda-metadata-v2-commit-${stamp}.json`),
    json,
    "utf-8"
  )
  await fs.writeFile(
    path.join(REPORTS_DIR, "aveda-metadata-v2-commit-latest.json"),
    json,
    "utf-8"
  )

  const totals = report.totals
  logger.info("──────────── METADATA V2 COMMIT ÖZET ────────────")
  logger.info(
    `processed=${totals.processed} eligible=${totals.eligible} updated=${totals.updated} unchanged=${totals.unchanged}`
  )
  logger.info(
    `skipped=${totals.skipped} stale_plan=${totals.stale_plan} failed=${totals.failed} db_writes=${totals.db_writes}`
  )
  logger.info(
    "Rapor: metadata-v2-reports/aveda-metadata-v2-commit-latest.json"
  )
}

function isProductRow(value: unknown): value is ProductRow {
  if (value === null || typeof value !== "object") return false
  return typeof Reflect.get(value, "id") === "string"
}
