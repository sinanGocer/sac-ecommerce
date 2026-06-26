/**
 * Catalog Product Quarantine — SAF orkestrasyon (IO yok).
 *
 * Snapshot + referans sayaçlarını alır; allowlist → kimlik → referans → plan →
 * fingerprint sırasıyla fail-closed bir plan üretir. DB/workflow ÇAĞIRMAZ.
 */

import { PROJECTION_POLICY_VERSION } from "../modules/search-projection/projection-policy"
import {
  computePlanFingerprint,
  QuarantineFingerprintPayload,
} from "./quarantine-fingerprint"
import {
  AllowlistResult,
  buildPlannedActions,
  evaluateAllowlist,
  evaluateIdentity,
  evaluateReferences,
  IdentityResult,
  ReferenceResult,
} from "./quarantine-plan"
import {
  ALLOWLISTED_PRODUCT_ID,
  EXPECTED_IDENTITY,
  PlannedAction,
  ProductSnapshot,
  QUARANTINE_POLICY_VERSION,
  QuarantineDecision,
  ReferenceCounts,
  TARGET_PRODUCT_STATUS,
  TARGET_SALES_CHANNEL_IDS,
} from "./quarantine-policy"

export interface QuarantineInput {
  requestedProductId: string
  matchedProductIds: string[]
  snapshot: ProductSnapshot | null
  counts: ReferenceCounts | null
}

export interface QuarantinePlan {
  allowlist: AllowlistResult
  identity: IdentityResult | null
  references: ReferenceResult | null
  actions: PlannedAction[]
  fingerprint_payload: QuarantineFingerprintPayload | null
  plan_fingerprint: string | null
  decision: QuarantineDecision
  unpublish_allowed: boolean
  delete_allowed: false
  errors: string[]
}

export function planQuarantine(input: QuarantineInput): QuarantinePlan {
  const errors: string[] = []
  const allowlist = evaluateAllowlist(
    input.requestedProductId,
    ALLOWLISTED_PRODUCT_ID,
    input.matchedProductIds
  )

  // 1) Allowlist fail-closed.
  if (!allowlist.ok || !input.snapshot || !input.counts) {
    if (!allowlist.ok && allowlist.reason) errors.push(`allowlist:${allowlist.reason}`)
    if (!input.snapshot) errors.push("snapshot_missing")
    if (!input.counts) errors.push("reference_counts_missing")
    return {
      allowlist,
      identity: null,
      references: input.counts ? evaluateReferences(input.counts) : null,
      actions: [],
      fingerprint_payload: null,
      plan_fingerprint: null,
      decision: "QUARANTINE_PLAN_BLOCKED",
      unpublish_allowed: false,
      delete_allowed: false,
      errors,
    }
  }

  // 2) Kimlik + provenance gate.
  const identity = evaluateIdentity(input.snapshot, EXPECTED_IDENTITY)
  const references = evaluateReferences(input.counts)
  if (!identity.ok) {
    for (const m of identity.mismatches) errors.push(`identity:${m.field}`)
    return {
      allowlist,
      identity,
      references,
      actions: [],
      fingerprint_payload: null,
      plan_fingerprint: null,
      decision: "QUARANTINE_STALE_PLAN",
      unpublish_allowed: references.unpublish_allowed,
      delete_allowed: false,
      errors,
    }
  }

  // 3) Plan + fingerprint.
  const actions = buildPlannedActions(input.snapshot)
  const md = input.snapshot.metadata ?? {}
  const fingerprintPayload: QuarantineFingerprintPayload = {
    policy_version: QUARANTINE_POLICY_VERSION,
    projection_policy_version: PROJECTION_POLICY_VERSION,
    product_id: input.snapshot.product_id,
    external_id: typeof md.external_id === "string" ? md.external_id : null,
    sku: [...input.snapshot.variant_skus].sort(),
    current_status: input.snapshot.status,
    target_status: TARGET_PRODUCT_STATUS,
    current_sales_channel_ids: input.snapshot.sales_channels.map((c) => c.id).sort(),
    target_sales_channel_ids: [...TARGET_SALES_CHANNEL_IDS].sort(),
    projection_action: input.snapshot.projection ? "remove" : "none",
    active_cart_line_count: input.counts.active_cart_lines,
    order_reference_count: references.order_reference_count,
    source_url: typeof md.source_url === "string" ? md.source_url : null,
    metadata_version:
      typeof md.metadata_version === "number" ? md.metadata_version : null,
  }
  const planFingerprint = computePlanFingerprint(fingerprintPayload)

  return {
    allowlist,
    identity,
    references,
    actions,
    fingerprint_payload: fingerprintPayload,
    plan_fingerprint: planFingerprint,
    decision: "QUARANTINE_DRY_RUN_READY",
    unpublish_allowed: references.unpublish_allowed,
    delete_allowed: false,
    errors,
  }
}
