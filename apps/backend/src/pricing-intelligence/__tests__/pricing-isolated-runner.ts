/* eslint-disable no-console */
import assert from "assert"

import { evaluateMatch, normalizeTitle, titleSimilarity } from "../competitor-matching"
import { computePricingFingerprint, isPricingCommitConfirmationValid } from "../pricing-fingerprint"
import {
  CompetitorOffer,
  DEFAULT_PRICE_RULE_CONFIG,
  MatchMethod,
  SafePriceInputs,
} from "../pricing-policy"
import { computeMinimumSafePrice, computeSuggestedPrice } from "../safe-price"
import { planPricing } from "../pricing-service"
import { buildPricingReport } from "../pricing-report"

let passed = 0
function ok(cond: unknown, label: string): void {
  assert.ok(cond, label)
  passed++
}

const NOW = "2026-06-29T12:00:00.000Z"

function offer(over: Partial<CompetitorOffer> = {}): CompetitorOffer {
  return {
    store: "rakip",
    product_price: 100,
    shipping: 0,
    in_stock: true,
    url: "https://example.com/p",
    crawled_at: NOW,
    match_method: "ean_gtin",
    volume_match: true,
    ...over,
  }
}

function safeInputs(over: Partial<SafePriceInputs> = {}): SafePriceInputs {
  return {
    unit_cost: 50,
    vat_rate: 0.2,
    payment_commission_rate: 0.025,
    shipping_contribution: 10,
    platform_cost: 5,
    min_profit_rate: 0.1,
    min_profit_abs: 5,
    ...over,
  }
}

function main(): void {
  // ── Matching priority ─────────────────────────────────────────────────────
  const base = {
    ean: null, gtin: null, sku: null, mpn: null,
    brand: "Aveda", normalized_title: "onarici sampuan", volume: "200 ml",
  }
  ok(evaluateMatch({ ...base, ean: "8717" }, { ...base, ean: "8717" }).method === "ean_gtin", "1 EAN match high")
  ok(evaluateMatch({ ...base, sku: "VC1" }, { ...base, sku: "vc1" }).confidence === "high", "2 SKU match high")
  ok(evaluateMatch(base, base).method === "brand_name_volume", "3 brand+name+volume medium")
  ok(
    evaluateMatch({ ...base, ean: "1" }, { ...base, ean: "1", volume: "1000 ml" }).confidence === "rejected",
    "4 wrong volume rejected even with EAN"
  )
  ok(
    evaluateMatch({ ...base, brand: "X" }, { ...base, brand: "Y", normalized_title: "tamamen alakasiz urun" }).confidence === "rejected",
    "5 no match rejected"
  )
  ok(titleSimilarity("onarici keratin sampuan", "keratin onarici sampuan") === 1, "6 title sim order-insensitive")
  ok(normalizeTitle("Onarıcı  Şampuan!!") === "onarıcı şampuan", "7 normalize title")

  // ── minimum_safe_price ────────────────────────────────────────────────────
  const msp = computeMinimumSafePrice(safeInputs())
  ok(msp.ok && msp.minimum_safe_price! > 65, "8 min safe price computed above base cost")
  // net check: price*(1/1.2 - 0.025) >= cost+platform+shipping+profit(=65+5=70)
  const p = msp.minimum_safe_price!
  const net = p * (1 / 1.2 - 0.025)
  ok(Math.abs(net - 70) < 0.05, "9 min safe price nets required amount")
  const bad = computeMinimumSafePrice(safeInputs({ vat_rate: 5, payment_commission_rate: 0.9 }))
  ok(!bad.ok && bad.error?.includes("net_factor"), "10 impossible margin blocked")

  // ── Suggested price: happy path ───────────────────────────────────────────
  const happy = computeSuggestedPrice({
    current_price: 200, list_price: 250, floor_override: null, ceiling_override: null,
    minimum_safe_price: 90,
    offers: [offer({ product_price: 180 }), offer({ product_price: 182 }), offer({ product_price: 185 })],
    last_change_at: null, now: NOW, config: DEFAULT_PRICE_RULE_CONFIG,
  })
  ok(happy.decision === "RECOMMEND_CHANGE" && happy.suggested_price === 179, "11 undercut lowest by 1 TL")

  // ── Floor never breached ──────────────────────────────────────────────────
  const floored = computeSuggestedPrice({
    current_price: 200, list_price: 250, floor_override: null, ceiling_override: null,
    minimum_safe_price: 195,
    offers: [offer({ product_price: 150 }), offer({ product_price: 152 })],
    last_change_at: null, now: NOW, config: DEFAULT_PRICE_RULE_CONFIG,
  })
  ok(floored.suggested_price! >= 195 && floored.reasons.includes("clamped_to_floor"), "12 floor not breached")

  // ── Out-of-stock excluded ─────────────────────────────────────────────────
  const oos = computeSuggestedPrice({
    current_price: 200, list_price: null, floor_override: null, ceiling_override: null,
    minimum_safe_price: 90,
    offers: [offer({ product_price: 100, in_stock: false }), offer({ product_price: 180 }), offer({ product_price: 182 })],
    last_change_at: null, now: NOW, config: DEFAULT_PRICE_RULE_CONFIG,
  })
  ok(oos.excluded.out_of_stock === 1 && oos.suggested_price === 179, "13 out-of-stock ignored")

  // ── Single anomalous cheap offer does not drive price ─────────────────────
  const anomaly = computeSuggestedPrice({
    current_price: 200, list_price: null, floor_override: null, ceiling_override: null,
    minimum_safe_price: 90,
    offers: [offer({ product_price: 30 }), offer({ product_price: 180 }), offer({ product_price: 182 }), offer({ product_price: 185 })],
    last_change_at: null, now: NOW, config: DEFAULT_PRICE_RULE_CONFIG,
  })
  ok(anomaly.excluded.anomaly === 1 && anomaly.suggested_price === 179, "14 anomaly excluded")

  // ── Wrong volume rejected ─────────────────────────────────────────────────
  const wrongVol = computeSuggestedPrice({
    current_price: 200, list_price: null, floor_override: null, ceiling_override: null,
    minimum_safe_price: 90,
    offers: [offer({ product_price: 100, volume_match: false }), offer({ product_price: 100, volume_match: false })],
    last_change_at: null, now: NOW, config: DEFAULT_PRICE_RULE_CONFIG,
  })
  ok(wrongVol.excluded.wrong_volume === 2 && wrongVol.decision === "BLOCKED_NO_RELIABLE_OFFERS", "15 wrong volume rejected")

  // ── Low-confidence fuzzy excluded ─────────────────────────────────────────
  const lowConf = computeSuggestedPrice({
    current_price: 200, list_price: null, floor_override: null, ceiling_override: null,
    minimum_safe_price: 90,
    offers: [offer({ match_method: "fuzzy" as MatchMethod }), offer({ match_method: "fuzzy" as MatchMethod })],
    last_change_at: null, now: NOW, config: DEFAULT_PRICE_RULE_CONFIG,
  })
  ok(lowConf.excluded.low_confidence === 2, "16 low-confidence fuzzy excluded")

  // ── Stale data blocked ────────────────────────────────────────────────────
  const stale = computeSuggestedPrice({
    current_price: 200, list_price: null, floor_override: null, ceiling_override: null,
    minimum_safe_price: 90,
    offers: [offer({ crawled_at: "2026-06-01T00:00:00.000Z" })],
    last_change_at: null, now: NOW, config: DEFAULT_PRICE_RULE_CONFIG,
  })
  ok(stale.decision === "BLOCKED_STALE_DATA", "17 stale competitor data blocked")

  // ── Cooldown holds ────────────────────────────────────────────────────────
  const cooldown = computeSuggestedPrice({
    current_price: 200, list_price: 250, floor_override: null, ceiling_override: null,
    minimum_safe_price: 90,
    offers: [offer({ product_price: 180 }), offer({ product_price: 182 })],
    last_change_at: "2026-06-29T06:00:00.000Z", now: NOW, config: DEFAULT_PRICE_RULE_CONFIG,
  })
  ok(cooldown.decision === "HOLD_COOLDOWN", "18 cooldown holds change")

  // ── Daily max change cap ──────────────────────────────────────────────────
  const capped = computeSuggestedPrice({
    current_price: 1000, list_price: 2000, floor_override: null, ceiling_override: null,
    minimum_safe_price: 90,
    offers: [offer({ product_price: 300 }), offer({ product_price: 305 })],
    last_change_at: null, now: NOW, config: DEFAULT_PRICE_RULE_CONFIG,
  })
  ok(capped.suggested_price === 850 && capped.reasons.includes("capped_max_daily_down"), "19 daily max change cap (15%)")

  // ── min_reliable_offers gate ──────────────────────────────────────────────
  const oneOffer = computeSuggestedPrice({
    current_price: 200, list_price: null, floor_override: null, ceiling_override: null,
    minimum_safe_price: 90,
    offers: [offer({ product_price: 180 })],
    last_change_at: null, now: NOW, config: DEFAULT_PRICE_RULE_CONFIG,
  })
  ok(oneOffer.decision === "BLOCKED_NO_RELIABLE_OFFERS", "20 below min reliable offers blocked")

  // ── Service + fingerprint + report ────────────────────────────────────────
  const plan = planPricing({
    now: NOW, mode: "dry-run",
    products: [{
      product_id: "prod_1", title: "Onarıcı Şampuan", current_price: 200, list_price: 250,
      floor_override: null, ceiling_override: null, safe_inputs: safeInputs(),
      offers: [offer({ product_price: 180 }), offer({ product_price: 182 })], last_change_at: null,
    }],
  })
  ok(plan.decision === "PRICING_DRY_RUN_READY" && plan.total_db_writes === 0, "21 plan dry-run ready, 0 writes")
  ok(plan.recommendations[0].decision === "RECOMMEND_CHANGE" && plan.recommendations.every((r) => r.db_writes === 0), "22 recommendation no writes")
  ok(plan.plan_fingerprint.length === 16, "23 fingerprint length")

  const noSource = planPricing({ now: NOW, mode: "dry-run", products: [] })
  ok(noSource.decision === "PRICING_NO_COMPETITOR_SOURCE", "24 no competitor source")

  // deterministic fingerprint
  ok(
    computePricingFingerprint(plan.fingerprint_payload) === computePricingFingerprint(plan.fingerprint_payload),
    "25 deterministic fingerprint"
  )
  ok(
    !isPricingCommitConfirmationValid("wrong", plan.plan_fingerprint) &&
      isPricingCommitConfirmationValid(plan.plan_fingerprint, plan.plan_fingerprint),
    "26 commit confirmation guard"
  )

  const report = buildPricingReport({
    runId: "r1", startedAt: NOW, finishedAt: NOW, competitorSource: "none", plan,
  })
  ok(report.actual_price_mutations === 0 && report.db_writes === 0 && report.mode === "dry-run", "27 report 0 mutations")
  ok(report.commit_command !== null && report.commit_command.includes(plan.plan_fingerprint), "28 report commit command gated by fingerprint")

  // No-SQL / no-mutation guard in source
  const fs = require("fs") as typeof import("fs")
  const path = require("path") as typeof import("path")
  const dir = path.resolve(process.cwd(), "src", "pricing-intelligence")
  const files = fs.readdirSync(dir).filter((f: string) => f.endsWith(".ts"))
  // Gerçek DB mutation göstergeleri (crypto .update() gibi saf çağrılar hariç).
  const mutationPattern = /core-flows|updateProductsWorkflow|createPriceSetsWorkflow|upsertPrices|\.upsert\(|INSERT\s+INTO|UPDATE\s+\w+\s+SET/i
  for (const f of files) {
    const content = fs.readFileSync(path.join(dir, f), "utf-8")
    ok(!mutationPattern.test(content), `29 no mutation/SQL in ${f}`)
  }

  console.log(`[pricing-intelligence:test] ${passed} assertions passed`)
}

try {
  main()
} catch (e) {
  console.error("PRICING TEST FAILED:", e instanceof Error ? e.message : e)
  process.exit(1)
}
