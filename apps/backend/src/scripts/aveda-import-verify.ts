import { promises as fs } from "fs"
import path from "path"

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { detectFormat, parseInput } from "../assisted-import/assisted-import-parse"
import { extractExternalId } from "../assisted-import/assisted-import-validate"
import { PROTECTED_HANDLES } from "../assisted-import/assisted-import-policy"

type QueryGraph = {
  graph: (input: unknown) => Promise<{ data?: unknown[]; metadata?: { count?: number } }>
}

const DEFAULT_INPUT = "import-input/aveda-new-products-enriched.csv"
const EXPECTED_NEW = 35
const EXPECTED_VISIBLE_AVEDA = 74

function fail(message: string): never {
  throw new Error(`[aveda-import-verify] ${message}`)
}

export default async function avedaImportVerify({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const inputFile = (process.env.IMPORT_INPUT_FILE ?? DEFAULT_INPUT).trim()
  const content = await fs.readFile(path.resolve(process.cwd(), inputFile), "utf-8")
  const records = parseInput(detectFormat(inputFile), content, path.basename(inputFile))
    .filter((record) => record.classification === "import_ready")
  const externalIds = records
    .map((record) => record.url ? extractExternalId(record.url) : null)
    .filter((id): id is string => typeof id === "string")

  if (externalIds.length !== EXPECTED_NEW || new Set(externalIds).size !== EXPECTED_NEW) {
    fail(`expected ${EXPECTED_NEW} unique new external ids, got ${externalIds.length}`)
  }

  const { data: salesChannels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
  })
  const defaultSalesChannel = (salesChannels ?? []).find(
    (channel) => (channel as { name?: string }).name === "Default Sales Channel"
  ) as { id?: string; name?: string } | undefined
  if (!defaultSalesChannel?.id) fail("Default Sales Channel not found")

  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "handle",
      "status",
      "thumbnail",
      "metadata",
      "images.url",
      "sales_channels.id",
      "variants.id",
      "variants.prices.amount",
      "variants.prices.currency_code",
    ],
  })

  const rows = (products ?? []) as Array<{
    id: string
    title?: string | null
    handle?: string | null
    status?: string | null
    thumbnail?: string | null
    metadata?: Record<string, unknown> | null
    images?: Array<{ url?: string | null }>
    sales_channels?: Array<{ id?: string | null }>
    variants?: Array<{
      id?: string | null
      prices?: Array<{ amount?: number | null; currency_code?: string | null }>
    }>
  }>

  const visibleAveda = rows.filter((row) => {
    const meta = row.metadata ?? {}
    return (
      row.status === "published" &&
      meta.sync_provider === "aveda" &&
      row.sales_channels?.some((channel) => channel.id === defaultSalesChannel.id)
    )
  })

  if (visibleAveda.length !== EXPECTED_VISIBLE_AVEDA) {
    fail(`visible Aveda expected ${EXPECTED_VISIBLE_AVEDA}, got ${visibleAveda.length}`)
  }

  const byExternalId = new Map(
    rows
      .map((row) => [row.metadata?.external_id, row] as const)
      .filter((entry): entry is [string, typeof rows[number]] => typeof entry[0] === "string")
  )

  const missing: string[] = []
  for (const externalId of externalIds) {
    const row = byExternalId.get(externalId)
    if (!row) {
      missing.push(`${externalId}:missing`)
      continue
    }
    const hasTryPrice = (row.variants ?? []).some((variant) =>
      (variant.prices ?? []).some(
        (price) => price.currency_code?.toLowerCase() === "try" && typeof price.amount === "number" && price.amount > 0
      )
    )
    const hasImage = Boolean(row.thumbnail) || (row.images ?? []).some((image) => Boolean(image.url))
    const inDefaultChannel = row.sales_channels?.some((channel) => channel.id === defaultSalesChannel.id)
    if (row.status !== "published") missing.push(`${externalId}:not_published`)
    if (!inDefaultChannel) missing.push(`${externalId}:missing_default_sales_channel`)
    if (!hasTryPrice) missing.push(`${externalId}:missing_try_price`)
    if (!hasImage) missing.push(`${externalId}:missing_image`)
    if (!(row.variants ?? []).length) missing.push(`${externalId}:missing_variant`)
    if (row.metadata?.metadata_version !== 2) missing.push(`${externalId}:metadata_v2_missing`)
  }
  if (missing.length > 0) fail(missing.join(", "))

  const protectedVisible = visibleAveda.filter((row) =>
    row.handle ? PROTECTED_HANDLES.includes(row.handle) : false
  )
  if (protectedVisible.length > 0) {
    fail(`protected handles visible: ${protectedVisible.map((row) => row.handle).join(",")}`)
  }

  const { data: projections } = await query.graph({
    entity: "product_search_projection",
    fields: ["id", "product_id", "external_id"],
  })
  if ((projections ?? []).length !== EXPECTED_VISIBLE_AVEDA) {
    fail(`projection expected ${EXPECTED_VISIBLE_AVEDA}, got ${(projections ?? []).length}`)
  }

  const sample = externalIds.slice(0, 3).map((externalId) => {
    const row = byExternalId.get(externalId)
    return { external_id: externalId, handle: row?.handle ?? null, title: row?.title ?? null }
  })

  logger.info("──────── AVEDA IMPORT VERIFY ────────")
  logger.info(`new_products=${externalIds.length} visible_aveda=${visibleAveda.length} projections=${(projections ?? []).length}`)
  logger.info(`sample=${JSON.stringify(sample)}`)
}
