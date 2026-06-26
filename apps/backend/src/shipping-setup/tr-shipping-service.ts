/**
 * Türkiye Shipping Setup — SAF orkestrasyon (IO yok).
 *
 * Snapshot + config → aşamalar + fingerprint + karar. Workflow/DB ÇAĞIRMAZ.
 */

import {
  computeTrShippingFingerprint,
  TrShippingFingerprintPayload,
} from "./tr-shipping-fingerprint"
import { evaluateTrShippingStages } from "./tr-shipping-plan"
import {
  StageResult,
  TARGET,
  TR_SHIPPING_SETUP_POLICY_VERSION,
  TrShippingConfig,
  TrShippingDecision,
  TrShippingSnapshot,
} from "./tr-shipping-policy"

export interface TrShippingPlan {
  stages: StageResult[]
  fingerprint_payload: TrShippingFingerprintPayload | null
  plan_fingerprint: string | null
  estimated_writes: number
  decision: TrShippingDecision
  conflicts: Array<{ stage: string; gate: string }>
  errors: string[]
}

/** Snapshot kısa durum imzaları (fingerprint için deterministik). */
function stockState(s: TrShippingSnapshot): string {
  const m = s.stock_locations.filter((x) => x.name === TARGET.stock_location_name)
  if (m.length === 0) return "absent"
  if (m.length > 1) return "duplicate"
  return `present:${m[0].id}`
}
function setState(s: TrShippingSnapshot): string {
  const m = s.fulfillment_sets.filter((x) => x.name === TARGET.fulfillment_set_name)
  if (m.length === 0) return "absent"
  if (m.length > 1) return "duplicate"
  return `present:${m[0].id}`
}
function zoneState(s: TrShippingSnapshot): string {
  const m = s.service_zones.filter((x) => x.name === TARGET.service_zone_name)
  if (m.length === 0) return "absent"
  if (m.length > 1) return "duplicate"
  return `present:${m[0].id}`
}
function geoState(s: TrShippingSnapshot): string {
  const zones = s.service_zones.filter((z) =>
    z.geo_country_codes.includes(TARGET.country_code)
  )
  if (zones.length === 0) return "absent"
  return zones
    .map((z) => `${z.name}:${z.id}`)
    .sort()
    .join("|")
}

export function planTrShipping(
  snapshot: TrShippingSnapshot | null,
  config: TrShippingConfig | null,
  envErrors: string[]
): TrShippingPlan {
  // Env doğrulaması başarısızsa fail-closed BLOCKED (plan üretilmez).
  if (envErrors.length > 0 || !config) {
    return {
      stages: [],
      fingerprint_payload: null,
      plan_fingerprint: null,
      estimated_writes: 0,
      decision: "TR_SHIPPING_SETUP_BLOCKED",
      conflicts: [],
      errors: envErrors.length > 0 ? envErrors : ["config_missing"],
    }
  }
  if (!snapshot) {
    return {
      stages: [],
      fingerprint_payload: null,
      plan_fingerprint: null,
      estimated_writes: 0,
      decision: "TR_SHIPPING_SETUP_BLOCKED",
      conflicts: [],
      errors: ["snapshot_missing"],
    }
  }
  if (!snapshot.region_id) {
    return {
      stages: [],
      fingerprint_payload: null,
      plan_fingerprint: null,
      estimated_writes: 0,
      decision: "TR_SHIPPING_SETUP_BLOCKED",
      conflicts: [],
      errors: ["tr_region_not_found"],
    }
  }

  const stages = evaluateTrShippingStages(snapshot, config)
  const estimatedWrites = stages.reduce((sum, s) => sum + s.estimated_writes, 0)

  const blocked = stages.filter((s) => s.status === "blocked")
  const conflicts = stages
    .filter((s) => s.status === "conflict")
    .map((s) => ({ stage: s.stage, gate: s.gate ?? "conflict" }))

  let decision: TrShippingDecision = "TR_SHIPPING_SETUP_DRY_RUN_READY"
  const errors: string[] = []
  if (blocked.length > 0) {
    decision = "TR_SHIPPING_SETUP_BLOCKED"
    for (const b of blocked) errors.push(`blocked:${b.stage}:${b.gate}`)
  } else if (conflicts.length > 0) {
    decision = "TR_SHIPPING_SETUP_CONFLICT"
    for (const c of conflicts) errors.push(`conflict:${c.stage}:${c.gate}`)
  }

  // Fingerprint yalnız temiz (DRY_RUN_READY) planda üretilir → commit token'ı.
  let fingerprintPayload: TrShippingFingerprintPayload | null = null
  let planFingerprint: string | null = null
  if (decision === "TR_SHIPPING_SETUP_DRY_RUN_READY") {
    fingerprintPayload = {
      policy_version: TR_SHIPPING_SETUP_POLICY_VERSION,
      region_id: snapshot.region_id,
      country_code: TARGET.country_code,
      currency: config.currency,
      sales_channel_id: snapshot.sales_channel_id,
      provider_id: TARGET.provider_id,
      stock_location_current_state: stockState(snapshot),
      fulfillment_set_current_state: setState(snapshot),
      service_zone_current_state: zoneState(snapshot),
      geo_zone_current_state: geoState(snapshot),
      shipping_profile_id: snapshot.shipping_profile_id,
      shipping_option_name: config.option_name,
      flat_amount: config.flat_amount,
      free_threshold: config.free_threshold,
      planned_actions: stages.map((s) => ({ stage: s.stage, status: s.status })),
    }
    planFingerprint = computeTrShippingFingerprint(fingerprintPayload)
  }

  return {
    stages,
    fingerprint_payload: fingerprintPayload,
    plan_fingerprint: planFingerprint,
    estimated_writes: estimatedWrites,
    decision,
    conflicts,
    errors,
  }
}
