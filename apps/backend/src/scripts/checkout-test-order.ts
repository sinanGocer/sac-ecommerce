import { promises as fs } from "fs"
import path from "path"

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  addShippingMethodToCartWorkflow,
  addToCartWorkflow,
  completeCartWorkflow,
  createCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
  updateCartWorkflow,
} from "@medusajs/medusa/core-flows"

import {
  ExecutionDeps,
  ExecutionResult,
  executeCheckoutTestOrder,
} from "../checkout-test/checkout-test-executor"
import { PreCompleteExpected } from "../checkout-test/checkout-test-plan"
import {
  checkCartTotalsConsistency,
  normalizeMoney,
  resolveShippingAmount,
} from "../checkout-test/money"
import { isCheckoutTestConfirmationValid } from "../checkout-test/checkout-test-fingerprint"
import {
  CheckoutTestDecision,
  CheckoutTestSnapshot,
  DuplicateGateState,
  EXPECTED_PRODUCT,
  EXPECTED_SHIPPING,
  InventoryLocationCandidate,
  PAYMENT_PROVIDER_ID,
  ProductSnap,
  QUANTITY,
  ShippingOptionSnap,
  TEST_ADDRESS,
  TEST_EMAIL,
  TEST_METADATA,
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
  let execution: ExecutionResult | null = null

  if (mode === "commit") {
    // ── Fail-closed execution guard ──────────────────────────────────────────
    if (plan.decision !== "CHECKOUT_TEST_ORDER_DRY_RUN_READY" || !plan.plan_fingerprint) {
      throw new Error(`[checkout:test] Fail-closed: plan commit'e uygun değil (decision=${plan.decision}). Mutation yapılmadı.`)
    }
    if (!isCheckoutTestConfirmationValid(confirmToken, plan.plan_fingerprint)) {
      throw new Error("[checkout:test] Fail-closed: CHECKOUT_TEST_CONFIRM plan_fingerprint ile eşleşmiyor. Mutation yapılmadı.")
    }
    if (!snapshot.product || !snapshot.shipping_option || !snapshot.region_id || !snapshot.sales_channel_id) {
      throw new Error("[checkout:test] Fail-closed: zorunlu kaynaklar çözülemedi. Mutation yapılmadı.")
    }

    const expected: PreCompleteExpected & { payment_provider_id: string } = {
      email: TEST_EMAIL,
      variant_id: snapshot.product.variant_id!,
      quantity: QUANTITY,
      unit_price: snapshot.product.unit_price!,
      shipping_option_id: snapshot.shipping_option.id,
      shipping_amount: snapshot.shipping_option.amount!,
      country_code: "tr",
      payment_provider_id: PAYMENT_PROVIDER_ID,
      grand_total: plan.totals.grand_total,
    }
    const deps = buildExecutionDeps(container, query, snapshot)
    execution = await executeCheckoutTestOrder(deps, expected)
    actualMutations = execution.actual_mutations
    finalDecision =
      execution.decision === "EXECUTION_COMMITTED" ? "CHECKOUT_TEST_ORDER_COMMITTED" : plan.decision
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
    execution,
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

  const inventoryCandidates = await inventoryLocationCandidates(query, product?.variant_id ?? null, scLocationIds)
  const duplicateGate = await duplicateTestOrderGate(query)

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
    inventory_location_candidates: inventoryCandidates,
    duplicate_gate: duplicateGate,
  }
}

async function inventoryLocationCandidates(
  query: QueryGraph,
  variantId: string | null,
  scLocationIds: Set<string>
): Promise<InventoryLocationCandidate[]> {
  if (!variantId) return []
  try {
    const { data } = await query.graph({
      entity: "product_variant_inventory_items",
      fields: [
        "variant_id",
        "inventory.location_levels.location_id",
        "inventory.location_levels.stocked_quantity",
        "inventory.location_levels.reserved_quantity",
        "inventory.location_levels.stock_locations.name",
      ],
      filters: { variant_id: [variantId] },
    })
    const out: InventoryLocationCandidate[] = []
    for (const link of (data ?? []) as Array<any>) {
      for (const lvl of link.inventory?.location_levels ?? []) {
        const available = Math.max(0, Number(lvl.stocked_quantity ?? 0) - Number(lvl.reserved_quantity ?? 0))
        out.push({
          location_id: lvl.location_id,
          name: (lvl.stock_locations ?? [])[0]?.name ?? null,
          available,
          in_sales_channel: scLocationIds.has(lvl.location_id),
        })
      }
    }
    return out
  } catch {
    return []
  }
}

async function duplicateTestOrderGate(query: QueryGraph): Promise<DuplicateGateState> {
  // Metadata order'a aktarımı garanti değil → email marker'ı ile aktif test order ara.
  try {
    const { data } = await query.graph({
      entity: "order",
      fields: ["id", "email", "status", "canceled_at"],
      filters: { email: TEST_EMAIL },
    })
    const active = ((data ?? []) as Array<any>).filter(
      (o) => o.canceled_at == null && o.status !== "canceled"
    )
    return {
      active_test_order_count: active.length,
      active_test_order_ids: active.map((o) => o.id),
      marker: active.length > 0 ? "email" : "none",
    }
  } catch {
    return { active_test_order_count: 0, active_test_order_ids: [], marker: "none" }
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

// ── Commit execution deps (Medusa public workflow/Store API zinciri) ─────────
// NOT: bu görevde commit modu ÇALIŞTIRILMAZ. Aşağıdaki bağlama gerçek mutation
// zinciridir ve yalnız fail-closed guard geçtikten sonra (ayrı onaylı adım)
// devreye girer. Mantık/sıra/guard'lar checkout-test-executor'da test edilir.

function buildExecutionDeps(
  container: ExecArgs["container"],
  query: QueryGraph,
  snapshot: CheckoutTestSnapshot
): ExecutionDeps {
  const variantId = snapshot.product!.variant_id!
  const optionId = snapshot.shipping_option!.id
  return {
    findActiveDuplicateTestOrder: async () => ({
      exists: snapshot.duplicate_gate.active_test_order_count > 0,
      order_ids: snapshot.duplicate_gate.active_test_order_ids,
    }),
    createCart: async () => {
      const { result } = await createCartWorkflow(container).run({
        input: {
          region_id: snapshot.region_id!,
          sales_channel_id: snapshot.sales_channel_id!,
          currency_code: "try",
        } as any,
      })
      return { cart_id: (result as any).id }
    },
    addLineItem: async (cartId: string) => {
      await addToCartWorkflow(container).run({
        input: { cart_id: cartId, items: [{ variant_id: variantId, quantity: QUANTITY }] } as any,
      })
      const id = await firstChildId(query, "cart", cartId, "items")
      return { line_item_id: id ?? "" }
    },
    setEmailAndAddress: async (cartId: string) => {
      await updateCartWorkflow(container).run({
        input: {
          id: cartId,
          email: TEST_EMAIL,
          shipping_address: { ...TEST_ADDRESS },
          billing_address: { ...TEST_ADDRESS },
          metadata: { ...TEST_METADATA },
        } as any,
      })
    },
    addShippingMethod: async (cartId: string) => {
      await addShippingMethodToCartWorkflow(container).run({
        input: { cart_id: cartId, options: [{ id: optionId }] } as any,
      })
      const id = await firstChildId(query, "cart", cartId, "shipping_methods")
      return { shipping_method_id: id ?? "" }
    },
    initPaymentSession: async (cartId: string) => {
      const { result: pc } = await createPaymentCollectionForCartWorkflow(container).run({
        input: { cart_id: cartId } as any,
      })
      const collectionId = (pc as any)?.id ?? null
      await createPaymentSessionsWorkflow(container).run({
        input: { payment_collection_id: collectionId, provider_id: PAYMENT_PROVIDER_ID } as any,
      })
      const { data } = await query.graph({
        entity: "payment_collection",
        fields: ["id", "payment_sessions.id", "payment_sessions.provider_id", "payment_sessions.status"],
        filters: { id: collectionId },
      })
      const session = (((data ?? [])[0] as any)?.payment_sessions ?? [])[0] ?? null
      return {
        payment_collection_id: collectionId,
        payment_session_id: session?.id ?? null,
        provider_id: session?.provider_id ?? null,
        status: session?.status ?? null,
      }
    },
    retrieveCartForComplete: async (cartId: string) => {
      const { data } = await query.graph({
        entity: "cart",
        fields: [
          "id", "email", "completed_at", "currency_code",
          "items.id", "items.variant_id", "items.product_id", "items.quantity", "items.unit_price", "items.subtotal",
          "shipping_methods.id", "shipping_methods.shipping_option_id", "shipping_methods.amount", "shipping_methods.total",
          "shipping_address.country_code",
          "payment_collection.payment_sessions.provider_id",
          "item_total", "shipping_total", "tax_total", "discount_total", "total",
        ],
        filters: { id: cartId },
      })
      const c = (data ?? [])[0] as any
      const item = (c?.items ?? [])[0] ?? null
      const sm = (c?.shipping_methods ?? [])[0] ?? null
      const ps = (c?.payment_collection?.payment_sessions ?? [])[0] ?? null

      // Money normalizasyonu: BigNumber/string/null → number|null (sessiz 0 yok).
      const shipping = resolveShippingAmount(c?.shipping_total, sm?.total, sm?.amount)
      const consistency = checkCartTotalsConsistency({
        item_total: c?.item_total,
        shipping_total: c?.shipping_total,
        tax_total: c?.tax_total,
        discount_total: c?.discount_total,
        total: c?.total,
      })

      return {
        created_by_this_run: true,
        email: c?.email ?? null,
        item_count: (c?.items ?? []).length,
        line: item
          ? {
              variant_id: item.variant_id,
              quantity: normalizeMoney(item.quantity),
              unit_price: normalizeMoney(item.unit_price),
            }
          : null,
        shipping_option_id: sm?.shipping_option_id ?? null,
        // Çözüm başarısız (kaynak çelişkisi/çözülemez) → null → gate bloklar.
        shipping_amount: shipping.ok ? shipping.amount : null,
        country_code: c?.shipping_address?.country_code ?? null,
        payment_provider_id: ps?.provider_id ?? null,
        completed_at: c?.completed_at ?? null,
        order_reference_count: c?.completed_at ? 1 : 0,
        // Tutarlılık başarısız → mismatch zorla (fail-closed); aksi halde normalize total.
        total: consistency.ok ? consistency.normalized.total! : -1,
      }
    },
    completeCart: async (cartId: string) => {
      const { result } = await completeCartWorkflow(container).run({ input: { id: cartId } as any })
      const orderId = (result as any)?.id ?? null
      return { type: orderId ? "order" : "cart", order_id: orderId }
    },
    retrieveOrder: async (orderId: string) => {
      const { data } = await query.graph({
        entity: "order",
        fields: [
          "id", "display_id", "email", "currency_code", "status",
          "items.id", "items.variant_id", "item_subtotal", "shipping_total", "tax_total", "total",
          "shipping_address.country_code", "payment_status", "fulfillment_status", "metadata",
        ],
        filters: { id: orderId },
      })
      const o = (data ?? [])[0] as any
      return {
        id: o?.id ?? orderId,
        display_id: o?.display_id ?? null,
        email: o?.email ?? null,
        currency_code: o?.currency_code ?? null,
        item_count: (o?.items ?? []).length,
        variant_ids: (o?.items ?? []).map((i: any) => i.variant_id).filter(Boolean),
        item_subtotal: typeof o?.item_subtotal === "number" ? o.item_subtotal : null,
        shipping_total: typeof o?.shipping_total === "number" ? o.shipping_total : null,
        tax_total: typeof o?.tax_total === "number" ? o.tax_total : null,
        grand_total: typeof o?.total === "number" ? o.total : null,
        shipping_country: o?.shipping_address?.country_code ?? null,
        status: o?.status ?? null,
        payment_status: o?.payment_status ?? null,
        fulfillment_status: o?.fulfillment_status ?? null,
        metadata: o?.metadata ?? null,
      }
    },
  }
}

async function firstChildId(
  query: QueryGraph,
  entity: string,
  id: string,
  relation: string
): Promise<string | null> {
  try {
    const { data } = await query.graph({ entity, fields: ["id", `${relation}.id`], filters: { id } })
    const rows = ((data ?? [])[0] as any)?.[relation] ?? []
    return rows[0]?.id ?? null
  } catch {
    return null
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
