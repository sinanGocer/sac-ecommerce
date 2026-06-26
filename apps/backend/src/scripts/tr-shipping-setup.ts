import { promises as fs } from "fs"
import path from "path"

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createShippingOptionsWorkflow,
  createStockLocationsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/medusa/core-flows"

import { isTrShippingConfirmationValid } from "../shipping-setup/tr-shipping-fingerprint"
import {
  parseTrShippingEnv,
  StockLocationRef,
  TARGET,
  TrShippingConfig,
  TrShippingDecision,
  TrShippingSnapshot,
} from "../shipping-setup/tr-shipping-policy"
import { planTrShipping } from "../shipping-setup/tr-shipping-service"
import { buildTrShippingReport } from "../shipping-setup/tr-shipping-report"

/**
 * Türkiye Shipping Setup — fail-closed, dry-run varsayılan.
 * Dry-run: yalnız read-only query + rapor (DB write 0). Gerçek commit yalnız
 * TR_SHIPPING_SETUP_COMMIT=true + TR_SHIPPING_SETUP_CONFIRM=<plan_fingerprint>
 * ile ve plan DRY_RUN_READY ise yapılır. RAW SQL YOK; tüm yazımlar Medusa public
 * workflow/module/link katmanından geçer. Avrupa zone / European Warehouse'a
 * dokunulmaz.
 */

const REPORTS_DIR = path.resolve(process.cwd(), "shipping-setup-reports")
const LATEST_REPORT = path.join(REPORTS_DIR, "tr-shipping-setup-latest.json")

type QueryGraph = {
  graph: (args: unknown, options?: unknown) => Promise<{ data?: unknown[] }>
}

export default async function trShippingSetup({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph

  const env = parseTrShippingEnv(process.env)
  const commitEnabled = process.env.TR_SHIPPING_SETUP_COMMIT === "true"
  const confirmToken = process.env.TR_SHIPPING_SETUP_CONFIRM ?? null
  const mode: "dry-run" | "commit" = commitEnabled ? "commit" : "dry-run"
  const startedAt = new Date().toISOString()

  const snapshot = env.ok ? await collectSnapshot(query) : null
  const plan = planTrShipping(snapshot, env.config, env.errors)

  let actualWrites = 0
  let finalDecision: TrShippingDecision = plan.decision

  if (mode === "commit") {
    const exec = await runCommit(container, plan, snapshot, env.config, confirmToken, logger)
    actualWrites = exec.actualWrites
    finalDecision = exec.decision
  }

  const finishedAt = new Date().toISOString()
  const runId = `trs_${Date.now().toString(36)}_${(plan.plan_fingerprint ?? "noplan").slice(0, 8)}`

  const report = buildTrShippingReport({
    runId,
    startedAt,
    finishedAt,
    mode,
    config: env.config,
    snapshot,
    plan,
    commitEnabled,
    actualWrites,
    finalDecision,
  })

  await writeReport(report)
  logSummary(logger, report)
}

// ── Commit yürütücü (bu görevde çalıştırılmaz; fail-closed tasarım) ──────────

async function runCommit(
  container: ExecArgs["container"],
  plan: ReturnType<typeof planTrShipping>,
  snapshot: TrShippingSnapshot | null,
  config: TrShippingConfig | null,
  confirmToken: string | null,
  logger: { info: (m: string) => void }
): Promise<{ actualWrites: number; decision: TrShippingDecision }> {
  if (plan.decision !== "TR_SHIPPING_SETUP_DRY_RUN_READY" || !plan.plan_fingerprint || !snapshot || !config) {
    throw new Error(
      `[shipping:tr] Fail-closed: plan commit'e uygun değil (decision=${plan.decision}). Yazım yapılmadı.`
    )
  }
  if (!isTrShippingConfirmationValid(confirmToken, plan.plan_fingerprint)) {
    throw new Error(
      "[shipping:tr] Fail-closed: TR_SHIPPING_SETUP_CONFIRM plan_fingerprint ile eşleşmiyor. Yazım yapılmadı."
    )
  }
  if (!snapshot.sales_channel_id || !snapshot.shipping_profile_id) {
    throw new Error("[shipping:tr] Fail-closed: sales_channel/shipping_profile çözülemedi.")
  }

  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const fulfillment = container.resolve(Modules.FULFILLMENT) as {
    createFulfillmentSets: (input: unknown) => Promise<{ id: string; service_zones: Array<{ id: string }> }>
  }
  const stageStatus = (id: string): string =>
    plan.stages.find((s) => s.stage === id)?.status ?? "skipped"

  let writes = 0

  // 1) Stock location (yoksa oluştur)
  let stockLocationId =
    snapshot.stock_locations.find((s) => s.name === TARGET.stock_location_name)?.id ?? null
  if (stageStatus("STOCK_LOCATION_CREATE_OR_REUSE") === "planned") {
    const { result } = await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          { name: TARGET.stock_location_name, address: { city: "Istanbul", country_code: "TR", address_1: "" } },
        ],
      },
    })
    stockLocationId = result[0].id
    writes++
    // stock location ↔ manual_manual fulfillment provider
    await link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocationId },
      [Modules.FULFILLMENT]: { fulfillment_provider_id: TARGET.provider_id },
    })
  }

  // 2) Sales channel link
  if (stageStatus("STOCK_LOCATION_SALES_CHANNEL_LINK") === "planned" && stockLocationId) {
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: { id: stockLocationId, add: [snapshot.sales_channel_id] },
    })
    writes++
  }

  // 3-5) Fulfillment set + service zone + tr geo zone (tek module çağrısı)
  let serviceZoneId =
    snapshot.service_zones.find((z) => z.name === TARGET.service_zone_name)?.id ?? null
  if (stageStatus("FULFILLMENT_SET_CREATE_OR_REUSE") === "planned") {
    const set = await fulfillment.createFulfillmentSets({
      name: TARGET.fulfillment_set_name,
      type: TARGET.fulfillment_set_type,
      service_zones: [
        { name: TARGET.service_zone_name, geo_zones: [{ country_code: TARGET.country_code, type: "country" }] },
      ],
    })
    serviceZoneId = set.service_zones[0].id
    writes++
    if (stockLocationId) {
      await link.create({
        [Modules.STOCK_LOCATION]: { stock_location_id: stockLocationId },
        [Modules.FULFILLMENT]: { fulfillment_set_id: set.id },
      })
    }
  }

  // 6) Shipping option (flat, manual_manual)
  if (stageStatus("SHIPPING_OPTION_CREATE_OR_REUSE") === "planned" && serviceZoneId) {
    await createShippingOptionsWorkflow(container).run({
      input: [
        {
          name: config.option_name,
          price_type: "flat",
          provider_id: TARGET.provider_id,
          service_zone_id: serviceZoneId,
          shipping_profile_id: snapshot.shipping_profile_id,
          type: { label: "Standart", description: "Türkiye kargo", code: "tr-standard" },
          prices: [{ currency_code: config.currency, amount: config.flat_amount }],
          rules: [
            { attribute: "enabled_in_store", value: "true", operator: "eq" },
            { attribute: "is_return", value: "false", operator: "eq" },
          ],
        },
      ],
    })
    writes++
  }

  logger.info(`[shipping:tr] commit yürütüldü — writes=${writes}`)
  return { actualWrites: writes, decision: "TR_SHIPPING_SETUP_COMMITTED" }
}

// ── Read-only snapshot ───────────────────────────────────────────────────────

async function collectSnapshot(query: QueryGraph): Promise<TrShippingSnapshot> {
  // Region: tr ülkesini kapsayan
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code", "countries.iso_2"],
  })
  const trRegion = ((regions ?? []) as Array<any>).find((r) =>
    (r.countries ?? []).some((c: any) => c.iso_2 === TARGET.country_code)
  )

  // Sales channel: tek aktif kanal (hardcode YOK)
  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name", "is_disabled"],
  })
  const active = ((channels ?? []) as Array<any>).filter((c) => c.is_disabled !== true)
  const salesChannel = active.length === 1 ? active[0] : null

  // Shipping profile: tek/default
  const { data: profiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id", "name", "type"],
  })
  const profileList = (profiles ?? []) as Array<any>
  const defaultProfile =
    profileList.find((p) => p.type === "default") ??
    profileList.find((p) => /default/i.test(p.name ?? "")) ??
    (profileList.length === 1 ? profileList[0] : null)

  // Stock locations + linkler
  const { data: locs } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name", "sales_channels.id", "fulfillment_sets.id"],
  })
  const stock_locations: StockLocationRef[] = ((locs ?? []) as Array<any>).map((l) => ({
    id: l.id,
    name: l.name,
    sales_channel_ids: (l.sales_channels ?? []).map((s: any) => s.id).filter(Boolean),
    fulfillment_set_ids: (l.fulfillment_sets ?? []).map((f: any) => f.id).filter(Boolean),
  }))

  // Fulfillment sets
  const { data: sets } = await query.graph({
    entity: "fulfillment_set",
    fields: ["id", "name", "type", "service_zones.id"],
  })
  const fulfillment_sets = ((sets ?? []) as Array<any>).map((f) => ({
    id: f.id,
    name: f.name,
    type: f.type ?? null,
    service_zone_ids: (f.service_zones ?? []).map((z: any) => z.id).filter(Boolean),
  }))

  // Service zones (+ geo + fulfillment set)
  const { data: zones } = await query.graph({
    entity: "service_zone",
    fields: ["id", "name", "fulfillment_set.id", "geo_zones.country_code"],
  })
  const service_zones = ((zones ?? []) as Array<any>).map((z) => ({
    id: z.id,
    name: z.name,
    fulfillment_set_id: z.fulfillment_set?.id ?? null,
    geo_country_codes: (z.geo_zones ?? [])
      .map((g: any) => (typeof g.country_code === "string" ? g.country_code.toLowerCase() : null))
      .filter((c: string | null): c is string => !!c),
  }))

  // Shipping options (+ prices)
  const { data: opts } = await query.graph({
    entity: "shipping_option",
    fields: [
      "id",
      "name",
      "provider_id",
      "price_type",
      "service_zone_id",
      "shipping_profile_id",
      "prices.amount",
      "prices.currency_code",
    ],
  })
  const shipping_options = ((opts ?? []) as Array<any>).map((o) => {
    const tryPrice = (o.prices ?? []).find(
      (p: any) => (p.currency_code ?? "").toLowerCase() === TARGET.currency
    )
    return {
      id: o.id,
      name: o.name,
      provider_id: o.provider_id ?? null,
      price_type: o.price_type ?? null,
      service_zone_id: o.service_zone_id ?? null,
      shipping_profile_id: o.shipping_profile_id ?? null,
      flat_amount: typeof tryPrice?.amount === "number" ? tryPrice.amount : null,
      currency: tryPrice ? TARGET.currency : null,
    }
  })

  return {
    region_id: trRegion?.id ?? null,
    region_currency: trRegion?.currency_code ?? null,
    region_countries: (trRegion?.countries ?? []).map((c: any) => c.iso_2).filter(Boolean),
    sales_channel_id: salesChannel?.id ?? null,
    sales_channel_name: salesChannel?.name ?? null,
    shipping_profile_id: defaultProfile?.id ?? null,
    shipping_profile_count: profileList.length,
    stock_locations,
    fulfillment_sets,
    service_zones,
    shipping_options,
  }
}

// ── Rapor & özet ─────────────────────────────────────────────────────────────

async function writeReport(report: ReturnType<typeof buildTrShippingReport>): Promise<void> {
  await fs.mkdir(REPORTS_DIR, { recursive: true })
  const stamp = report.finished_at.replace(/[:.]/g, "-")
  const fp = report.plan_fingerprint ?? "noplan"
  const json = JSON.stringify(report, null, 2)
  await fs.writeFile(path.join(REPORTS_DIR, `tr-shipping-setup-${stamp}-${fp}.json`), json, "utf-8")
  await fs.writeFile(LATEST_REPORT, json, "utf-8")
}

function logSummary(
  logger: { info: (m: string) => void; warn: (m: string) => void },
  report: ReturnType<typeof buildTrShippingReport>
): void {
  logger.info("──────────── TR SHIPPING SETUP ÖZET ────────────")
  logger.info(
    `mode=${report.mode} decision=${report.final_decision} region=${report.resolved_region?.id ?? "-"} sales_channel=${report.resolved_sales_channel?.id ?? "-"}`
  )
  logger.info(
    `estimated_writes=${report.estimated_db_writes} actual_writes=${report.actual_db_writes} plan_fingerprint=${report.plan_fingerprint ?? "-"}`
  )
  for (const s of report.planned_actions) {
    logger.info(`  - ${s.stage}: ${s.status} (writes=${s.estimated_writes})${s.gate ? " gate=" + s.gate : ""}`)
  }
  if (report.conflicts.length > 0) {
    report.conflicts.forEach((c) => logger.warn(`[shipping:tr] conflict: ${c.stage} (${c.gate})`))
  }
  if (report.errors.length > 0) report.errors.forEach((e) => logger.warn(`[shipping:tr] error: ${e}`))
  if (report.mode === "dry-run" && report.generated_commit_command) {
    logger.info(`Commit komutu (çalıştırılmadı): ${report.generated_commit_command}`)
  }
  logger.info("Rapor: shipping-setup-reports/tr-shipping-setup-latest.json")
}
