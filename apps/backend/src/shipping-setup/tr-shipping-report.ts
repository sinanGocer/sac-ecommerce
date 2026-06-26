/**
 * Türkiye Shipping Setup — rapor yapısı + commit komutu (SAF).
 */

import { TrShippingPlan } from "./tr-shipping-service"
import {
  StageResult,
  TR_SHIPPING_SETUP_POLICY_VERSION,
  TrShippingConfig,
  TrShippingDecision,
  TrShippingSnapshot,
} from "./tr-shipping-policy"

export interface TrShippingReport {
  run_id: string
  started_at: string
  finished_at: string
  mode: "dry-run" | "commit"
  policy_version: number
  requested_config: {
    option_name: string | null
    flat_amount: number | null
    currency: string | null
    free_threshold: number | null
    note: string
  }
  resolved_region: { id: string | null; currency: string | null; countries: string[] } | null
  resolved_sales_channel: { id: string | null; name: string | null } | null
  resolved_shipping_profile_id: string | null
  current_snapshot: TrShippingSnapshot | null
  conflicts: Array<{ stage: string; gate: string }>
  gates: { env_ok: boolean; region_ok: boolean; blocked_stages: string[] }
  planned_actions: StageResult[]
  estimated_db_writes: number
  actual_db_writes: number
  base_fingerprint: string | null
  plan_fingerprint: string | null
  commit_enabled: boolean
  final_decision: TrShippingDecision
  errors: string[]
  generated_commit_command: string | null
}

export function buildTrCommitCommand(
  config: TrShippingConfig,
  planFingerprint: string
): string {
  const threshold =
    config.free_threshold !== null
      ? `TR_SHIPPING_FREE_THRESHOLD=${config.free_threshold} `
      : ""
  return (
    `cd ~/sac-ecommerce/apps/backend && env ` +
    `TR_SHIPPING_OPTION_NAME=${JSON.stringify(config.option_name)} ` +
    `TR_SHIPPING_FLAT_AMOUNT=${config.flat_amount} ` +
    `TR_SHIPPING_CURRENCY=${config.currency} ` +
    threshold +
    `TR_SHIPPING_SETUP_COMMIT=true ` +
    `TR_SHIPPING_SETUP_CONFIRM=${planFingerprint} ` +
    `npm run shipping:tr:setup`
  )
}

export function buildTrShippingReport(params: {
  runId: string
  startedAt: string
  finishedAt: string
  mode: "dry-run" | "commit"
  config: TrShippingConfig | null
  snapshot: TrShippingSnapshot | null
  plan: TrShippingPlan
  commitEnabled: boolean
  actualWrites: number
  finalDecision: TrShippingDecision
}): TrShippingReport {
  const { plan, snapshot, config } = params
  const blockedStages = plan.stages
    .filter((s) => s.status === "blocked")
    .map((s) => s.stage)

  return {
    run_id: params.runId,
    started_at: params.startedAt,
    finished_at: params.finishedAt,
    mode: params.mode,
    policy_version: TR_SHIPPING_SETUP_POLICY_VERSION,
    requested_config: {
      option_name: config?.option_name ?? null,
      flat_amount: config?.flat_amount ?? null,
      currency: config?.currency ?? null,
      free_threshold: config?.free_threshold ?? null,
      note:
        "flat_amount yalnızca teknik dry-run planlama değeridir; production kargo ücreti kararı değildir.",
    },
    resolved_region: snapshot
      ? {
          id: snapshot.region_id,
          currency: snapshot.region_currency,
          countries: snapshot.region_countries,
        }
      : null,
    resolved_sales_channel: snapshot
      ? { id: snapshot.sales_channel_id, name: snapshot.sales_channel_name }
      : null,
    resolved_shipping_profile_id: snapshot?.shipping_profile_id ?? null,
    current_snapshot: snapshot,
    conflicts: plan.conflicts,
    gates: {
      env_ok: config !== null,
      region_ok: !!snapshot?.region_id,
      blocked_stages: blockedStages,
    },
    planned_actions: plan.stages,
    estimated_db_writes: plan.estimated_writes,
    actual_db_writes: params.actualWrites,
    base_fingerprint: plan.plan_fingerprint,
    plan_fingerprint: plan.plan_fingerprint,
    commit_enabled: params.commitEnabled,
    final_decision: params.finalDecision,
    errors: plan.errors,
    generated_commit_command:
      params.mode === "dry-run" && plan.plan_fingerprint && config
        ? buildTrCommitCommand(config, plan.plan_fingerprint)
        : null,
  }
}
