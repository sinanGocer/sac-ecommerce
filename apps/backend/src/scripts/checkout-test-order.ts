import { promises as fs } from "fs"
import path from "path"

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { isCheckoutTestConfirmationValid } from "../checkout-test/checkout-test-fingerprint"
import {
  CheckoutTestDecision,
  CheckoutTestSnapshot,
  EXPECTED_PRODUCT,
  EXPECTED_SHIPPING,
  PAYMENT_PROVIDER_ID,
  ProductSnap,
  ShippingOptionSnap,
} from "../checkout-test/checkout-test-policy"
import { planCheckoutTest } from "../checkout-test/checkout-test-service"
import { buildCheckoutTestReport } from "../checkout-test/checkout-test-report"

/**
 * Checkout Test Order — pp_system_default ile uçtan uca tek test siparişi.
 * VARSAYILAN: DRY-RUN (mutation 0). Bu görevde commit ÇALIŞTIRILMAZ. Commit
 * yalnız CHECKOUT_TEST_COMMIT=true + CHECKOUT_TEST_CONFIRM=<plan_fingerprint>
 * ile ve plan DRY_RUN_READY ise yapılır; pre-complete revalidation başarısızsa
 * complete edilmez. RAW SQL YOK. Mevcut cart'lar değiştirilmez; yeni cart yalnız
 * commit modunda oluşturulur.
 */

const REPORTS_DIR = path.resolve(process.cwd(), "checkout-test-reports")
const LATEST_REPORT = path.join(REPORTS_DIR, "checkout-test-order-latest.json")

type QueryGraph = { graph: (args: unknown, options?: unknown) => Promise<{ data?: unknown[] }> }

export default async function checkoutTestOrder({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph

  const commitEnabled = process.env.CHECKOUT_TEST_COMMIT === "true"
  const confirmToken = process.env.CHECKOUT_TEST_CONFIRM ?? null
  const mode: "dry-run" | "commit" = commitEnabled ? "commit" : "dry-run"
  const startedAt = new Date().toISOString()

  const snapshot = await collectSnapshot(query)
  const plan = planCheckoutTest(snapshot)

  let actualMutations = 0
  let finalDecision: CheckoutTestDecision = plan.decision

  if (mode === "commit") {
    // Fail-closed: bu araç commit yolunu yalnız açık onayla yürütür.
    if (plan.decision !== "CHECKOUT_TEST_ORDER_DRY_RUN_READY" || !plan.plan_fingerprint) {
      throw new Error(`[checkout:test] Fail-closed: plan commit'e uygun değil (decision=${plan.decision}).`)
    }
    if (!isCheckoutTestConfirmationValid(confirmToken, plan.plan_fingerprint)) {
      throw new Error("[checkout:test] Fail-closed: CHECKOUT_TEST_CONFIRM plan_fingerprint ile eşleşmiyor. Mutation yapılmadı.")
    }
    // Gerçek sipariş oluşturma bu görev kapsamında DEĞİL — ayrı onaylı adımda
    // etkinleştirilir. Buraya kadar gelinse bile fail-closed durur.
    throw new Error("[checkout:test] Commit yürütme ayrı onaylı adımda etkinleştirilir; bu derlemede devre dışı (fail-closed).")
  }

  const finishedAt = new Date().toISOString()
  const runId = `cto_${Date.now().toString(36)}_${(plan.plan_fingerprint ?? "noplan").slice(0, 8)}`

  const report = buildCheckoutTestReport({
    runId,
    startedAt,
    finishedAt,
    mode,
    snapshot,
    plan,
    commitEnabled,
    actualMutations,
    finalDecision,
  })

  await writeReport(report)
  logSummary(logger, report)
}

// ── Read-only snapshot ───────────────────────────────────────────────────────

async function collectSnapshot(query: QueryGraph): Promise<CheckoutTestSnapshot> {
  // Region (tr)
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "currency_code", "countries.iso_2"],
  })
  const trRegion = ((regions ?? []) as Array<any>).find((r) =>
    (r.countries ?? []).some((c: any) => c.iso_2 === "tr")
  )

  // Sales channel (tek aktif)
  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name", "is_disabled", "stock_locations.id"],
  })
  const active = ((channels ?? []) as Array<any>).filter((c) => c.is_disabled !== true)
  const sc = active.length === 1 ? active[0] : null
  const scLocationIds = new Set<string>(((sc?.stock_locations ?? []) as Array<any>).map((l) => l.id).filter(Boolean))

  // Publishable key kimliği (DEĞER değil, id)
  let pkId: string | null = null
  try {
    const { data: keys } = await query.graph({ entity: "api_key", fields: ["id", "type", "revoked_at"] })
    const pub = ((keys ?? []) as Array<any>).find((k) => k.type === "publishable" && !k.revoked_at)
    pkId = pub?.id ?? null
  } catch {
    pkId = null
  }

  // Tax rate (tr)
  let taxRate = 0
  try {
    const { data: tr } = await query.graph({
      entity: "tax_region",
      fields: ["country_code", "tax_rates.rate", "tax_rates.is_default"],
      filters: { country_code: "tr" },
    })
    const rates = (((tr ?? [])[0] as any)?.tax_rates ?? []) as Array<any>
    const def = rates.find((r) => r.is_default) ?? rates[0]
    if (def && typeof def.rate === "number") taxRate = def.rate / 100
  } catch {
    taxRate = 0
  }

  // Ürün
  const { data: prods } = await query.graph({
    entity: "product",
    fields: [
      "id", "status",
      "sales_channels.id",
      "shipping_profile.id",
      "variants.id", "variants.sku", "variants.manage_inventory",
      "variants.prices.amount", "variants.prices.currency_code",
    ],
    filters: { id: EXPECTED_PRODUCT.product_id },
  })
  const pr = ((prods ?? [])[0] as any) ?? null
  let product: ProductSnap | null = null
  if (pr) {
    const variants = (pr.variants ?? []) as Array<any>
    const v = variants.find((x) => x.id === EXPECTED_PRODUCT.variant_id) ?? variants[0]
    const tp = (v?.prices ?? []).find((p: any) => (p.currency_code ?? "").toLowerCase() === "try")
    const reservable = await reservableQuantity(query, v?.id ?? null, scLocationIds)
    product = {
      id: pr.id,
      status: pr.status ?? "unknown",
      in_sales_channel: ((pr.sales_channels ?? []) as Array<any>).some((c) => c.id === sc?.id),
      variant_id: v?.id ?? null,
      sku: v?.sku ?? null,
      unit_price: typeof tp?.amount === "number" ? tp.amount : null,
      currency: tp ? "try" : null,
      manage_inventory: typeof v?.manage_inventory === "boolean" ? v.manage_inventory : null,
      variant_count: variants.length,
      reservable_quantity: reservable,
      shipping_profile_id: pr.shipping_profile?.id ?? null,
    }
  }

  // Shipping option (TR)
  const { data: opts } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "name", "provider_id", "service_zone.name", "prices.amount", "prices.currency_code"],
    filters: { id: EXPECTED_SHIPPING.option_id },
  })
  const so = ((opts ?? [])[0] as any) ?? null
  let shipping_option: ShippingOptionSnap | null = null
  if (so) {
    const tp = (so.prices ?? []).find((p: any) => (p.currency_code ?? "").toLowerCase() === "try")
    const zoneName = so.service_zone?.name ?? null
    shipping_option = {
      id: so.id,
      name: so.name,
      provider_id: so.provider_id ?? null,
      amount: typeof tp?.amount === "number" ? tp.amount : null,
      currency: tp ? "try" : null,
      service_zone_name: zoneName,
      is_europe: zoneName === "Europe",
    }
  }

  // Payment provider
  const { data: pps } = await query.graph({ entity: "payment_provider", fields: ["id", "is_enabled"] })
  const ppRow = ((pps ?? []) as Array<any>).find((p) => p.id === PAYMENT_PROVIDER_ID) ?? null

  return {
    region_id: trRegion?.id ?? null,
    region_currency: trRegion?.currency_code ?? null,
    region_countries: (trRegion?.countries ?? []).map((c: any) => c.iso_2).filter(Boolean),
    sales_channel_id: sc?.id ?? null,
    sales_channel_name: sc?.name ?? null,
    publishable_key_identity: pkId,
    tax_rate: taxRate,
    product,
    shipping_option,
    payment_provider: ppRow ? { id: ppRow.id, is_enabled: ppRow.is_enabled !== false } : null,
  }
}

async function reservableQuantity(
  query: QueryGraph,
  variantId: string | null,
  locationIds: Set<string>
): Promise<number> {
  if (!variantId) return 0
  try {
    const { data } = await query.graph({
      entity: "product_variant_inventory_items",
      fields: [
        "variant_id",
        "inventory.location_levels.location_id",
        "inventory.location_levels.stocked_quantity",
        "inventory.location_levels.reserved_quantity",
      ],
      filters: { variant_id: [variantId] },
    })
    let total = 0
    for (const link of (data ?? []) as Array<any>) {
      for (const lvl of link.inventory?.location_levels ?? []) {
        if (locationIds.size > 0 && !locationIds.has(lvl.location_id)) continue
        const s = Number(lvl.stocked_quantity ?? 0)
        const r = Number(lvl.reserved_quantity ?? 0)
        total += Math.max(0, s - r)
      }
    }
    return total
  } catch {
    return 0
  }
}

// ── Rapor & özet ─────────────────────────────────────────────────────────────

async function writeReport(report: ReturnType<typeof buildCheckoutTestReport>): Promise<void> {
  await fs.mkdir(REPORTS_DIR, { recursive: true })
  const stamp = report.finished_at.replace(/[:.]/g, "-")
  const fp = report.plan_fingerprint ?? "noplan"
  const json = JSON.stringify(report, null, 2)
  await fs.writeFile(path.join(REPORTS_DIR, `checkout-test-order-${stamp}-${fp}.json`), json, "utf-8")
  await fs.writeFile(LATEST_REPORT, json, "utf-8")
}

function logSummary(
  logger: { info: (m: string) => void; warn: (m: string) => void },
  report: ReturnType<typeof buildCheckoutTestReport>
): void {
  logger.info("──────────── CHECKOUT TEST ORDER ÖZET ────────────")
  logger.info(`mode=${report.mode} decision=${report.final_decision} commit_enabled=${report.commit_enabled}`)
  logger.info(
    `product=${report.selected_variant?.id ?? "-"} unit_price=${report.selected_variant?.unit_price ?? "-"} shipping=${(report.shipping_option as any)?.amount ?? "-"} provider=${(report.payment_provider as any)?.id ?? "-"}`
  )
  const t = report.expected_totals
  logger.info(`totals: subtotal=${t.subtotal} shipping=${t.shipping_total} tax=${t.tax_total} grand_total=${t.grand_total}`)
  logger.info(`estimated_mutations=${report.estimated_mutations} actual_mutations=${report.actual_mutations} plan_fingerprint=${report.plan_fingerprint ?? "-"}`)
  for (const s of report.planned_actions) {
    logger.info(`  - ${s.stage}: ${s.kind}/${s.status} (mut=${s.estimated_mutations})${s.gate ? " gate=" + s.gate : ""}`)
  }
  if (report.gates.blocked_count > 0) report.gates.blockers.forEach((b) => logger.warn(`[checkout:test] blocker: ${b.stage} (${b.gate})`))
  if (report.mode === "dry-run" && report.generated_commit_command) {
    logger.info(`Commit komutu (çalıştırılmadı): ${report.generated_commit_command}`)
  }
  logger.info("Rapor: checkout-test-reports/checkout-test-order-latest.json")
}
