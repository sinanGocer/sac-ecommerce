/**
 * Competitive Pricing — rapor + audit yapısı (SAF).
 */

import { PRICING_POLICY_VERSION } from "./pricing-policy"
import { PricingPlan } from "./pricing-service"

export interface PricingReport {
  run_id: string
  started_at: string
  finished_at: string
  mode: "dry-run" | "commit"
  policy_version: number
  competitor_source: string
  batch_decision: PricingPlan["decision"]
  product_count: number
  summary: Record<string, number>
  recommendations: PricingPlan["recommendations"]
  /** Audit: değişiklik önerilen ürünlerin denetim satırları. */
  audit_log: Array<{
    product_id: string
    decision: string
    current_price: number
    suggested_price: number | null
    minimum_safe_price: number | null
    lowest_reliable_total: number | null
    reasons: string[]
  }>
  plan_fingerprint: string
  actual_price_mutations: 0
  db_writes: 0
  commit_command: string | null
}

export function buildPricingReport(params: {
  runId: string
  startedAt: string
  finishedAt: string
  competitorSource: string
  plan: PricingPlan
}): PricingReport {
  const { plan } = params
  const auditLog = plan.recommendations.map((r) => ({
    product_id: r.product_id,
    decision: r.decision,
    current_price: r.current_price,
    suggested_price: r.suggested_price,
    minimum_safe_price: r.minimum_safe_price,
    lowest_reliable_total: r.lowest_reliable_total,
    reasons: r.reasons,
  }))

  const hasRecommendations = plan.recommendations.some(
    (r) => r.decision === "RECOMMEND_CHANGE"
  )

  return {
    run_id: params.runId,
    started_at: params.startedAt,
    finished_at: params.finishedAt,
    mode: plan.mode,
    policy_version: PRICING_POLICY_VERSION,
    competitor_source: params.competitorSource,
    batch_decision: plan.decision,
    product_count: plan.recommendations.length,
    summary: plan.summary,
    recommendations: plan.recommendations,
    audit_log: auditLog,
    plan_fingerprint: plan.plan_fingerprint,
    actual_price_mutations: 0,
    db_writes: 0,
    // Gerçek yazım komutu yalnız öneri varsa ve ayrı confirmation ile (bu fazda
    // ÇALIŞTIRILMAZ). Token = plan_fingerprint.
    commit_command:
      plan.mode === "dry-run" && hasRecommendations
        ? `PRICE_AUTOMATION_MODE=commit PRICE_COMMIT_CONFIRM=${plan.plan_fingerprint} npm run pricing:intelligence:commit`
        : null,
  }
}
