/* eslint-disable no-console */
import assert from "assert"

import {
  computeTrShippingFingerprint,
  isTrShippingConfirmationValid,
  TrShippingFingerprintPayload,
} from "../tr-shipping-fingerprint"
import {
  parseTrShippingEnv,
  TR_SHIPPING_SETUP_POLICY_VERSION,
  TrShippingConfig,
  TrShippingSnapshot,
} from "../tr-shipping-policy"
import { planTrShipping } from "../tr-shipping-service"

/** jest'siz izole test runner. Çalıştırma: npm run shipping:tr:setup:test */
let passed = 0
function ok(cond: unknown, label: string): void {
  assert.ok(cond, label)
  passed++
}

const CONFIG: TrShippingConfig = {
  option_name: "Türkiye Standart Kargo",
  flat_amount: 100,
  currency: "try",
  free_threshold: null,
}

/** Yalnız Avrupa kurulumu olan temiz snapshot (TR kaynakları YOK). */
function cleanSnapshot(): TrShippingSnapshot {
  return {
    region_id: "reg_tr",
    region_currency: "try",
    region_countries: ["tr"],
    sales_channel_id: "sc_default",
    sales_channel_name: "Default Sales Channel",
    shipping_profile_id: "sp_default",
    shipping_profile_count: 1,
    stock_locations: [
      { id: "sloc_eu", name: "European Warehouse", sales_channel_ids: ["sc_default"], fulfillment_set_ids: ["fs_eu"] },
    ],
    fulfillment_sets: [
      { id: "fs_eu", name: "European Warehouse delivery", type: "shipping", service_zone_ids: ["sz_eu"] },
    ],
    service_zones: [
      { id: "sz_eu", name: "Europe", fulfillment_set_id: "fs_eu", geo_country_codes: ["gb", "de", "fr"] },
    ],
    shipping_options: [
      { id: "so_std", name: "Standard Shipping", provider_id: "manual_manual", price_type: "flat", service_zone_id: "sz_eu", shipping_profile_id: "sp_default", flat_amount: 10, currency: "try" },
    ],
  }
}

/** TR kaynaklarının tümü doğru kurulu (idempotent) snapshot. */
function fullSnapshot(): TrShippingSnapshot {
  const s = cleanSnapshot()
  s.stock_locations.push({ id: "sloc_tr", name: "Türkiye Deposu", sales_channel_ids: ["sc_default"], fulfillment_set_ids: ["fs_tr"] })
  s.fulfillment_sets.push({ id: "fs_tr", name: "Türkiye Teslimat", type: "shipping", service_zone_ids: ["sz_tr"] })
  s.service_zones.push({ id: "sz_tr", name: "Türkiye", fulfillment_set_id: "fs_tr", geo_country_codes: ["tr"] })
  s.shipping_options.push({ id: "so_tr", name: "Türkiye Standart Kargo", provider_id: "manual_manual", price_type: "flat", service_zone_id: "sz_tr", shipping_profile_id: "sp_default", flat_amount: 100, currency: "try" })
  return s
}

function statusOf(plan: ReturnType<typeof planTrShipping>, stage: string): string {
  return plan.stages.find((s) => s.stage === stage)?.status ?? "missing"
}

function noSqlAndScopeGuard(): void {
  const fs = require("fs") as typeof import("fs")
  const path = require("path") as typeof import("path")
  const dir = path.resolve(process.cwd(), "src", "shipping-setup")
  const sqlPattern = /\b(SELECT|INSERT|UPDATE|DELETE|DROP)\s+.*\b(FROM|INTO|TABLE|WHERE|SET)\b/i
  const scLiteral = /["']sc_[A-Za-z0-9]{20,}["']/
  for (const file of fs.readdirSync(dir).filter((f: string) => f.endsWith(".ts"))) {
    const content = fs.readFileSync(path.join(dir, file), "utf-8")
    ok(!sqlPattern.test(content), `no raw SQL in ${file}`)
    ok(!scLiteral.test(content), `no hardcoded sales channel id in ${file}`)
  }
  const script = fs.readFileSync(path.resolve(process.cwd(), "src", "scripts", "tr-shipping-setup.ts"), "utf-8")
  ok(!sqlPattern.test(script), "no raw SQL in tr-shipping-setup.ts")
  ok(!scLiteral.test(script), "no hardcoded sales channel id in script")
  ok(/query\.graph/.test(script) && /Workflow/.test(script), "script uses Medusa public layer")
}

function main(): void {
  // 1) Temiz DB → tüm create aşamaları planned
  const clean = planTrShipping(cleanSnapshot(), CONFIG, [])
  ok(
    clean.decision === "TR_SHIPPING_SETUP_DRY_RUN_READY" &&
      statusOf(clean, "STOCK_LOCATION_CREATE_OR_REUSE") === "planned" &&
      statusOf(clean, "FULFILLMENT_SET_CREATE_OR_REUSE") === "planned" &&
      statusOf(clean, "SERVICE_ZONE_CREATE_OR_REUSE") === "planned" &&
      statusOf(clean, "GEO_ZONE_TR_CREATE_OR_REUSE") === "planned" &&
      statusOf(clean, "SHIPPING_OPTION_CREATE_OR_REUSE") === "planned" &&
      clean.estimated_writes > 0 &&
      clean.plan_fingerprint !== null,
    "1 clean → all create planned"
  )

  // 2) Tüm kaynaklar doğru → no-op (idempotent, estimated writes 0)
  const full = planTrShipping(fullSnapshot(), CONFIG, [])
  ok(
    full.decision === "TR_SHIPPING_SETUP_DRY_RUN_READY" &&
      full.estimated_writes === 0 &&
      full.stages.every((s) => s.status === "no_op" || s.status === "skipped"),
    "2 all correct → no-op"
  )

  // 3) Stock location duplicate → conflict
  {
    const s = cleanSnapshot()
    s.stock_locations.push({ id: "sloc_tr1", name: "Türkiye Deposu", sales_channel_ids: [], fulfillment_set_ids: [] })
    s.stock_locations.push({ id: "sloc_tr2", name: "Türkiye Deposu", sales_channel_ids: [], fulfillment_set_ids: [] })
    const p = planTrShipping(s, CONFIG, [])
    ok(p.decision === "TR_SHIPPING_SETUP_CONFLICT" && statusOf(p, "STOCK_LOCATION_CREATE_OR_REUSE") === "conflict", "3 duplicate stock location conflict")
  }

  // 4) TR service zone duplicate → conflict
  {
    const s = fullSnapshot()
    s.service_zones.push({ id: "sz_tr2", name: "Türkiye", fulfillment_set_id: "fs_tr", geo_country_codes: ["tr"] })
    const p = planTrShipping(s, CONFIG, [])
    ok(p.decision === "TR_SHIPPING_SETUP_CONFLICT" && statusOf(p, "SERVICE_ZONE_CREATE_OR_REUSE") === "conflict", "4 duplicate service zone conflict")
  }

  // 5) tr geo zone yanlış (protected Europe) set altında → conflict
  {
    const s = cleanSnapshot()
    s.service_zones[0].geo_country_codes.push("tr") // Europe zone'a tr eklenmiş
    const p = planTrShipping(s, CONFIG, [])
    ok(p.decision === "TR_SHIPPING_SETUP_CONFLICT" && statusOf(p, "GEO_ZONE_TR_CREATE_OR_REUSE") === "conflict", "5 tr geo in protected zone conflict")
  }

  // 6) Option aynı isim farklı fiyat → conflict
  {
    const s = fullSnapshot()
    s.shipping_options = s.shipping_options.map((o) => (o.name === CONFIG.option_name ? { ...o, flat_amount: 999 } : o))
    const p = planTrShipping(s, CONFIG, [])
    ok(p.decision === "TR_SHIPPING_SETUP_CONFLICT" && statusOf(p, "SHIPPING_OPTION_CREATE_OR_REUSE") === "conflict", "6 option price conflict")
  }

  // 7) Option aynı yapı → no_op
  ok(statusOf(full, "SHIPPING_OPTION_CREATE_OR_REUSE") === "no_op", "7 option same structure no_op")

  // 8) Currency TRY dışında → blocked (env)
  {
    const e = parseTrShippingEnv({ TR_SHIPPING_OPTION_NAME: "X", TR_SHIPPING_FLAT_AMOUNT: "100", TR_SHIPPING_CURRENCY: "usd" })
    const p = planTrShipping(cleanSnapshot(), e.config, e.errors)
    ok(!e.ok && p.decision === "TR_SHIPPING_SETUP_BLOCKED", "8 non-TRY currency blocked")
  }

  // 9) Flat amount 0/negatif → blocked
  {
    const e0 = parseTrShippingEnv({ TR_SHIPPING_OPTION_NAME: "X", TR_SHIPPING_FLAT_AMOUNT: "0", TR_SHIPPING_CURRENCY: "try" })
    const eNeg = parseTrShippingEnv({ TR_SHIPPING_OPTION_NAME: "X", TR_SHIPPING_FLAT_AMOUNT: "-5", TR_SHIPPING_CURRENCY: "try" })
    ok(!e0.ok && !eNeg.ok, "9 flat amount 0/negative blocked")
  }

  // 10) Geçersiz threshold → blocked
  {
    const e = parseTrShippingEnv({ TR_SHIPPING_OPTION_NAME: "X", TR_SHIPPING_FLAT_AMOUNT: "100", TR_SHIPPING_CURRENCY: "try", TR_SHIPPING_FREE_THRESHOLD: "50" })
    ok(!e.ok && e.errors.some((x) => /THRESHOLD/.test(x)), "10 threshold <= flat blocked")
  }

  // 11) Threshold boş → free rule skipped
  ok(statusOf(clean, "FREE_SHIPPING_RULE_CREATE_OR_REUSE") === "skipped", "11 no threshold → skipped")

  // 12) Dry-run → tüm aşamalar executed=false
  ok(clean.stages.every((s) => s.executed === false), "12 dry-run no execution")

  // 13) Yanlış token reddedilir
  ok(
    !isTrShippingConfirmationValid("wrong", clean.plan_fingerprint!) &&
      !isTrShippingConfirmationValid(null, clean.plan_fingerprint!) &&
      isTrShippingConfirmationValid(clean.plan_fingerprint!, clean.plan_fingerprint!),
    "13 confirm token check"
  )

  // 14) Deterministik fingerprint
  const payload: TrShippingFingerprintPayload = {
    policy_version: TR_SHIPPING_SETUP_POLICY_VERSION,
    region_id: "reg_tr",
    country_code: "tr",
    currency: "try",
    sales_channel_id: "sc_default",
    provider_id: "manual_manual",
    stock_location_current_state: "absent",
    fulfillment_set_current_state: "absent",
    service_zone_current_state: "absent",
    geo_zone_current_state: "absent",
    shipping_profile_id: "sp_default",
    shipping_option_name: "Türkiye Standart Kargo",
    flat_amount: 100,
    free_threshold: null,
    planned_actions: [{ stage: "STOCK_LOCATION_CREATE_OR_REUSE", status: "planned" }],
  }
  ok(computeTrShippingFingerprint(payload) === computeTrShippingFingerprint({ ...payload }), "14 deterministic fingerprint")

  // 15) Policy version değişince fingerprint değişir
  ok(computeTrShippingFingerprint(payload) !== computeTrShippingFingerprint({ ...payload, policy_version: 2 }), "15 policy version changes fp")

  // 16) State değişince fingerprint değişir
  ok(computeTrShippingFingerprint(payload) !== computeTrShippingFingerprint({ ...payload, stock_location_current_state: "present:sloc_tr" }), "16 state changes fp")
  ok(clean.plan_fingerprint !== full.plan_fingerprint, "16b clean vs full fingerprint differ")

  // 17) Scope dışı Europe zone korunur (hiçbir stage Europe kaynağını hedeflemez)
  {
    const euIds = ["sloc_eu", "fs_eu", "sz_eu", "so_std"]
    const touchesEu = clean.stages.some((s) =>
      Object.values(s.dependency_ids).some((id) => id !== null && euIds.includes(id))
    )
    ok(!touchesEu, "17 Europe resources untouched")
  }

  // 18) Default sales channel hardcode edilmez (source scan içinde) + plan snapshot'tan alır
  ok(payload.sales_channel_id === "sc_default" && clean.fingerprint_payload?.sales_channel_id === "sc_default", "18 sales channel from snapshot")

  // 19+ no raw SQL + scope guard (kaynak tarama)
  noSqlAndScopeGuard()

  // 20) Report actual writes 0 — plan estimated > 0 ama dry-run actual write üretmez
  ok(clean.estimated_writes > 0, "20 estimated > 0 (actual writes handled in dry-run=0 by script)")

  // 21) Partial state: location var, set yok → location no_op, set planned
  {
    const s = cleanSnapshot()
    s.stock_locations.push({ id: "sloc_tr", name: "Türkiye Deposu", sales_channel_ids: ["sc_default"], fulfillment_set_ids: [] })
    const p = planTrShipping(s, CONFIG, [])
    ok(
      statusOf(p, "STOCK_LOCATION_CREATE_OR_REUSE") === "no_op" &&
        statusOf(p, "STOCK_LOCATION_SALES_CHANNEL_LINK") === "no_op" &&
        statusOf(p, "FULFILLMENT_SET_CREATE_OR_REUSE") === "planned" &&
        p.decision === "TR_SHIPPING_SETUP_DRY_RUN_READY",
      "21 partial state safe completion"
    )
  }

  // 22) Shipping profile uyumsuzluğu → blocked
  {
    const s = cleanSnapshot()
    s.shipping_profile_id = null
    const p = planTrShipping(s, CONFIG, [])
    ok(p.decision === "TR_SHIPPING_SETUP_BLOCKED" && statusOf(p, "SHIPPING_OPTION_CREATE_OR_REUSE") === "blocked", "22 shipping profile unresolved blocked")
  }

  console.log(`TR SHIPPING SETUP ISOLATED TESTS: ${passed} PASSED`)
}

try {
  main()
} catch (e) {
  console.error("TR SHIPPING TEST FAILED:", e instanceof Error ? e.message : e)
  process.exit(1)
}
