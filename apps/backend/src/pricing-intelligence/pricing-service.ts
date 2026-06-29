/**
 * Competitive Pricing — SAF orkestrasyon (IO yok, dry-run).
 *
 * Ürün başına minimum_safe_price + önerilen fiyatı hesaplar, audit kaydı ve
 * deterministik fingerprint üretir. DB/workflow ÇAĞIRMAZ; db_writes her zaman 0.
 */

import {
  computePricingFingerprint,
  PriceFingerprintEntry,
  PricingFingerprintPayload,
} from "./pricing-fingerprint"
import {
  CompetitorOffer,
  DEFAULT_PRICE_RULE_CONFIG,
  PriceAutomationMode,
  PriceRuleConfig,
  PricingBatchDecision,
  PRICING_POLICY_VERSION,
  SafePriceInputs,
} from "./pricing-policy"
import {
  computeMinimumSafePrice,
  computeSuggestedPrice,
  SuggestedPriceResult,
} from "./safe-price"

export interface PricingProductInput {
  product_id: string
  title: string | null
  current_price: number
  list_price: number | null
  floor_override: number | null
  ceiling_override: number | null
  safe_inputs: SafePriceInputs
  offers: CompetitorOffer[]
  last_change_at: string | null
}

export interface PricingRecommendation {
  product_id: string
  title: string | null
  decision: SuggestedPriceResult["decision"] | "BLOCKED_MISSING_INPUTS"
  current_price: number
  minimum_safe_price: number | null
  suggested_price: number | null
  effective_floor: number | null
  lowest_reliable_total: number | null
  reliable_offer_count: number
  excluded: SuggestedPriceResult["excluded"] | null
  reasons: string[]
  /** Dry-run'da her zaman 0 (öneri yalnız raporlanır). */
  db_writes: 0
}

export interface PricingPlan {
  mode: PriceAutomationMode
  decision: PricingBatchDecision
  recommendations: PricingRecommendation[]
  fingerprint_payload: PricingFingerprintPayload
  plan_fingerprint: string
  total_db_writes: 0
  summary: Record<string, number>
}

export interface PricingPlanInput {
  products: PricingProductInput[]
  now: string
  mode: PriceAutomationMode
  config?: PriceRuleConfig
}

export function planPricing(input: PricingPlanInput): PricingPlan {
  const config = input.config ?? DEFAULT_PRICE_RULE_CONFIG
  const recommendations: PricingRecommendation[] = []
  const fpEntries: PriceFingerprintEntry[] = []
  const summary: Record<string, number> = {}
  let anyOffers = false

  for (const p of input.products) {
    if (p.offers.length > 0) anyOffers = true

    const msp = computeMinimumSafePrice(p.safe_inputs)
    if (!msp.ok || msp.minimum_safe_price === null) {
      const rec: PricingRecommendation = {
        product_id: p.product_id,
        title: p.title,
        decision: "BLOCKED_MISSING_INPUTS",
        current_price: p.current_price,
        minimum_safe_price: null,
        suggested_price: null,
        effective_floor: null,
        lowest_reliable_total: null,
        reliable_offer_count: 0,
        excluded: null,
        reasons: [msp.error ?? "minimum_safe_price_failed"],
        db_writes: 0,
      }
      recommendations.push(rec)
      summary[rec.decision] = (summary[rec.decision] ?? 0) + 1
      fpEntries.push({
        product_id: p.product_id,
        decision: rec.decision,
        current_price: p.current_price,
        suggested_price: null,
        effective_floor: 0,
        lowest_reliable_total: null,
      })
      continue
    }

    const sp = computeSuggestedPrice({
      current_price: p.current_price,
      list_price: p.list_price,
      floor_override: p.floor_override,
      ceiling_override: p.ceiling_override,
      minimum_safe_price: msp.minimum_safe_price,
      offers: p.offers,
      last_change_at: p.last_change_at,
      now: input.now,
      config,
    })

    const rec: PricingRecommendation = {
      product_id: p.product_id,
      title: p.title,
      decision: sp.decision,
      current_price: p.current_price,
      minimum_safe_price: msp.minimum_safe_price,
      suggested_price: sp.suggested_price,
      effective_floor: sp.effective_floor,
      lowest_reliable_total: sp.lowest_reliable_total,
      reliable_offer_count: sp.reliable_offer_count,
      excluded: sp.excluded,
      reasons: sp.reasons,
      db_writes: 0,
    }
    recommendations.push(rec)
    summary[rec.decision] = (summary[rec.decision] ?? 0) + 1
    fpEntries.push({
      product_id: p.product_id,
      decision: sp.decision,
      current_price: p.current_price,
      suggested_price: sp.suggested_price,
      effective_floor: sp.effective_floor,
      lowest_reliable_total: sp.lowest_reliable_total,
    })
  }

  let decision: PricingBatchDecision = "PRICING_DRY_RUN_READY"
  if (input.products.length === 0 || !anyOffers) {
    decision = "PRICING_NO_COMPETITOR_SOURCE"
  }

  const fingerprintPayload: PricingFingerprintPayload = {
    policy_version: PRICING_POLICY_VERSION,
    mode: input.mode,
    entries: fpEntries,
  }

  return {
    mode: input.mode,
    decision,
    recommendations,
    fingerprint_payload: fingerprintPayload,
    plan_fingerprint: computePricingFingerprint(fingerprintPayload),
    total_db_writes: 0,
    summary,
  }
}
