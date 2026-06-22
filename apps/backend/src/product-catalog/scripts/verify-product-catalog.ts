import { promises as fs } from "fs"
import path from "path"

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { REPORTS_DIR } from "../../product-sync/services/sync.service"

export default async function verifyProductCatalog({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_category",
    fields: ["id", "name", "handle", "parent_category_id", "external_id"],
  })

  const managed = data
    .filter(
      (category) =>
        typeof category.external_id === "string" &&
        category.external_id.startsWith("product-catalog:category:")
    )
    .map((category) => ({
      id: category.id,
      name: category.name,
      handle: category.handle,
      parent_category_id: category.parent_category_id ?? null,
      external_id: category.external_id,
    }))

  const byExternalId = new Map<string, typeof managed>()
  for (const category of managed) {
    const rows = byExternalId.get(category.external_id) ?? []
    rows.push(category)
    byExternalId.set(category.external_id, rows)
  }

  const duplicates = [...byExternalId.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([external_id, rows]) => ({ external_id, rows }))

  const report = {
    generatedAt: new Date().toISOString(),
    managedCount: managed.length,
    uniqueExternalIdCount: byExternalId.size,
    duplicateExternalIds: duplicates,
    categories: managed.sort((a, b) => a.external_id.localeCompare(b.external_id)),
  }

  await fs.mkdir(REPORTS_DIR, { recursive: true })
  const json = JSON.stringify(report, null, 2)
  const stamp = report.generatedAt.replace(/[:.]/g, "-")
  await fs.writeFile(
    path.join(REPORTS_DIR, `product-catalog-verify-${stamp}.json`),
    json,
    "utf-8"
  )
  await fs.writeFile(
    path.join(REPORTS_DIR, "product-catalog-verify-latest.json"),
    json,
    "utf-8"
  )

  logger.info(
    `[catalog:verify] managed=${report.managedCount} unique_external_ids=${report.uniqueExternalIdCount} duplicate_external_ids=${duplicates.length}`
  )
  logger.info("Rapor: sync-reports/product-catalog-verify-latest.json")
}
