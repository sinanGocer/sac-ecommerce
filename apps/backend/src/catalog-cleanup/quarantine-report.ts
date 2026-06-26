/**
 * Catalog Product Quarantine — rapor yapısı + commit komutu (SAF).
 */

import { QuarantinePlan } from "./quarantine-service"
import {
  ALLOWLISTED_PRODUCT_ID,
  PlannedAction,
  ProductSnapshot,
  QUARANTINE_POLICY_VERSION,
  QuarantineDecision,
  ReferenceCounts,
  TARGET_PRODUCT_STATUS,
} from "./quarantine-policy"

export interface QuarantineReport {
  run_id: string
  started_at: string
  finished_at: string
  mode: "dry-run" | "commit"
  policy_version: number
  projection_policy_version: number | null
  product_id: string
  identity_snapshot: Record<string, unknown> | null
  current_state: {
    status: string
    sales_channel_ids: string[]
    sales_channel_names: string[]
    projection_exists: boolean
  } | null
  target_state: {
    status: string
    sales_channel_ids: string[]
    projection_action: "remove" | "none" | null
  }
  reference_counts: ReferenceCounts | null
  allowlist_result: QuarantinePlan["allowlist"]
  gate_results: {
    allowlist_ok: boolean
    identity_ok: boolean | null
    identity_mismatches: string[]
    unpublish_allowed: boolean
    delete_allowed: false
    delete_would_be_safe: boolean | null
    delete_blockers: string[]
  }
  planned_actions: PlannedAction[]
  skipped_actions: PlannedAction[]
  base_fingerprint: string | null
  plan_fingerprint: string | null
  commit_enabled: boolean
  db_writes: number
  projection_writes: number
  final_decision: QuarantineDecision
  cart_line_impact: Record<string, unknown>
  commit_command: string | null
  errors: string[]
}

/** Aktif cart line etkisi notu (read-only gözlem; cart'a dokunulmaz). */
export function cartLineImpact(counts: ReferenceCounts | null): Record<string, unknown> {
  return {
    cart_line_preserved: true,
    active_cart_lines: counts?.active_cart_lines ?? null,
    note_storefront:
      "Ürün draft + sales channel'dan çıkınca Store API ürünü artık döndürmez (liste/detay gizlenir).",
    note_existing_cart:
      "Mevcut cart_line_item satırı korunur; line item title/unit_price snapshot olduğundan sepet görüntülemede kalmaya devam edebilir (bu araç satırı silmez).",
    note_checkout_risk:
      "Checkout/cart tamamlamada ürün draft + sales channel dışı olduğundan doğrulama hatası riski vardır; ayrı bir checkout/cart-cleanup gate'i gerekebilir.",
    separate_checkout_gate_recommended: (counts?.active_cart_lines ?? 0) > 0,
  }
}

/** Dry-run sonunda raporlanacak (çalıştırılmayan) commit komutu. */
export function buildCommitCommand(planFingerprint: string): string {
  return (
    `cd ~/sac-ecommerce/apps/backend && env ` +
    `CATALOG_QUARANTINE_PRODUCT_ID=${ALLOWLISTED_PRODUCT_ID} ` +
    `CATALOG_QUARANTINE_COMMIT=true ` +
    `CATALOG_QUARANTINE_CONFIRM=${planFingerprint} ` +
    `npm run catalog:quarantine`
  )
}

export function buildReport(params: {
  runId: string
  startedAt: string
  finishedAt: string
  mode: "dry-run" | "commit"
  snapshot: ProductSnapshot | null
  counts: ReferenceCounts | null
  plan: QuarantinePlan
  commitEnabled: boolean
  dbWrites: number
  projectionWrites: number
  finalDecision: QuarantineDecision
  actions: PlannedAction[]
}): QuarantineReport {
  const { plan, snapshot, counts } = params
  const planned = params.actions.filter((a) => a.status === "planned")
  const skipped = params.actions.filter((a) => a.status === "no_op")

  return {
    run_id: params.runId,
    started_at: params.startedAt,
    finished_at: params.finishedAt,
    mode: params.mode,
    policy_version: QUARANTINE_POLICY_VERSION,
    projection_policy_version:
      plan.fingerprint_payload?.projection_policy_version ?? null,
    product_id: plan.allowlist.requested_product_id,
    identity_snapshot: plan.identity?.identity_snapshot ?? null,
    current_state: snapshot
      ? {
          status: snapshot.status,
          sales_channel_ids: snapshot.sales_channels.map((c) => c.id).sort(),
          sales_channel_names: snapshot.sales_channels
            .map((c) => c.name)
            .filter((n): n is string => typeof n === "string"),
          projection_exists: snapshot.projection !== null,
        }
      : null,
    target_state: {
      status: TARGET_PRODUCT_STATUS,
      sales_channel_ids: [],
      projection_action: plan.fingerprint_payload?.projection_action ?? null,
    },
    reference_counts: counts,
    allowlist_result: plan.allowlist,
    gate_results: {
      allowlist_ok: plan.allowlist.ok,
      identity_ok: plan.identity ? plan.identity.ok : null,
      identity_mismatches: plan.identity
        ? plan.identity.mismatches.map((m) => m.field)
        : [],
      unpublish_allowed: plan.unpublish_allowed,
      delete_allowed: false,
      delete_would_be_safe: plan.references?.delete_would_be_safe ?? null,
      delete_blockers: plan.references?.delete_blockers ?? [],
    },
    planned_actions: planned,
    skipped_actions: skipped,
    base_fingerprint: plan.plan_fingerprint,
    plan_fingerprint: plan.plan_fingerprint,
    commit_enabled: params.commitEnabled,
    db_writes: params.dbWrites,
    projection_writes: params.projectionWrites,
    final_decision: params.finalDecision,
    cart_line_impact: cartLineImpact(counts),
    commit_command:
      params.mode === "dry-run" && plan.plan_fingerprint
        ? buildCommitCommand(plan.plan_fingerprint)
        : null,
    errors: plan.errors,
  }
}
