import {
  ALLOWLISTED_SEED_PRODUCTS,
  PlannedSeedAction,
  ProductReferenceCounts,
  SALON_SEED_CLEANUP_POLICY_VERSION,
  SalonSeedCleanupDecision,
  SeedProductSnapshot,
  TARGET_PRODUCT_STATUS,
} from "./salon-seed-cleanup-policy"
import {
  computeSalonSeedCleanupFingerprint,
  SalonSeedCleanupFingerprintPayload,
} from "./salon-seed-cleanup-fingerprint"

export interface SalonSeedCleanupInput {
  snapshots: SeedProductSnapshot[]
  countsByProductId: Record<string, ProductReferenceCounts>
}

export interface SalonSeedCleanupPlan {
  decision: SalonSeedCleanupDecision
  matched_product_ids: string[]
  missing_product_ids: string[]
  unexpected_product_ids: string[]
  blocked_product_ids: string[]
  blockers: Array<{ product_id: string; blockers: string[] }>
  planned_actions: PlannedSeedAction[]
  fingerprint_payload: SalonSeedCleanupFingerprintPayload | null
  plan_fingerprint: string | null
  db_writes: 0
  errors: string[]
}

const ALLOWLIST_IDS: string[] = ALLOWLISTED_SEED_PRODUCTS.map((p) => p.product_id)
const ALLOWLIST_HANDLES: string[] = ALLOWLISTED_SEED_PRODUCTS.map((p) => p.handle)

export function planSalonSeedCleanup(
  input: SalonSeedCleanupInput
): SalonSeedCleanupPlan {
  const matchedIds = [...new Set(input.snapshots.map((s) => s.product_id))].sort()
  const missing = ALLOWLIST_IDS.filter((id) => !matchedIds.includes(id))
  const unexpected = matchedIds.filter((id) => !ALLOWLIST_IDS.includes(id))
  const errors: string[] = []

  for (const expected of ALLOWLISTED_SEED_PRODUCTS) {
    const snapshot = input.snapshots.find((s) => s.product_id === expected.product_id)
    if (!snapshot) continue
    if (snapshot.handle !== expected.handle) {
      errors.push(`identity:${expected.product_id}:handle`)
    }
    if (snapshot.title !== expected.title) {
      errors.push(`identity:${expected.product_id}:title`)
    }
  }

  if (missing.length > 0 || unexpected.length > 0 || errors.length > 0) {
    return {
      decision: "SALON_SEED_CLEANUP_SCOPE_MISMATCH",
      matched_product_ids: matchedIds,
      missing_product_ids: missing,
      unexpected_product_ids: unexpected,
      blocked_product_ids: [],
      blockers: [],
      planned_actions: [],
      fingerprint_payload: null,
      plan_fingerprint: null,
      db_writes: 0,
      errors,
    }
  }

  const blockers = input.snapshots
    .map((snapshot) => {
      const counts = input.countsByProductId[snapshot.product_id]
      return {
        product_id: snapshot.product_id,
        blockers: referenceBlockers(counts),
      }
    })
    .filter((row) => row.blockers.length > 0)

  const blockedIds = blockers.map((row) => row.product_id).sort()
  const blocked = blockedIds.length > 0
  const actions = input.snapshots
    .sort((a, b) => (a.handle ?? "").localeCompare(b.handle ?? ""))
    .flatMap((snapshot) => buildActions(snapshot, blockedIds.includes(snapshot.product_id)))

  const fingerprintPayload: SalonSeedCleanupFingerprintPayload = {
    policy_version: SALON_SEED_CLEANUP_POLICY_VERSION,
    product_ids: ALLOWLIST_IDS,
    handles: ALLOWLIST_HANDLES,
    current_statuses: input.snapshots.map((snapshot) => ({
      product_id: snapshot.product_id,
      status: snapshot.status,
    })),
    current_sales_channel_ids: input.snapshots.map((snapshot) => ({
      product_id: snapshot.product_id,
      sales_channel_ids: snapshot.sales_channels.map((c) => c.id).sort(),
    })),
    projection_actions: input.snapshots.map((snapshot) => ({
      product_id: snapshot.product_id,
      action: snapshot.projection ? "remove" : "none",
    })),
    reference_counts: input.snapshots.map((snapshot) => {
      const counts = input.countsByProductId[snapshot.product_id]
      return {
        product_id: snapshot.product_id,
        active_cart_lines: counts?.active_cart_lines ?? 0,
        completed_cart_lines: counts?.completed_cart_lines ?? 0,
        order_lines: counts?.order_lines ?? 0,
        order_items: counts?.order_items ?? 0,
        blocking_order_lines: counts?.blocking_order_lines ?? 0,
        safe_test_order_lines: counts?.safe_test_order_lines ?? 0,
      }
    }),
  }

  return {
    decision: blocked
      ? "SALON_SEED_CLEANUP_BLOCKED"
      : "SALON_SEED_CLEANUP_DRY_RUN_READY",
    matched_product_ids: matchedIds,
    missing_product_ids: [],
    unexpected_product_ids: [],
    blocked_product_ids: blockedIds,
    blockers,
    planned_actions: actions,
    fingerprint_payload: fingerprintPayload,
    plan_fingerprint: computeSalonSeedCleanupFingerprint(fingerprintPayload),
    db_writes: 0,
    errors,
  }
}

/**
 * Policy v2: yalnız sınıflandırılmış blocking sinyalleri engeller.
 *   - active cart line                                 → block
 *   - blocking order line (active/non-test/captured/...)→ block
 * historical completed cart ve canceled-test order satırları engellemez.
 */
function referenceBlockers(counts: ProductReferenceCounts | undefined): string[] {
  if (!counts) return ["reference_counts_missing"]
  const blockers: string[] = []
  if (counts.active_cart_lines > 0) blockers.push("active_cart_lines")
  if (counts.blocking_order_lines > 0) blockers.push("blocking_order")
  return blockers
}

function buildActions(
  snapshot: SeedProductSnapshot,
  blocked: boolean
): PlannedSeedAction[] {
  const channelIds = snapshot.sales_channels.map((c) => c.id).sort()
  const status: "planned" | "no_op" | "blocked" = blocked ? "blocked" : "planned"
  return [
    {
      product_id: snapshot.product_id,
      handle: snapshot.handle,
      action: "PRODUCT_UNPUBLISH",
      status: snapshot.status === TARGET_PRODUCT_STATUS ? "no_op" : status,
      executed: false,
      db_writes: 0,
      detail: {
        current_status: snapshot.status,
        target_status: TARGET_PRODUCT_STATUS,
      },
    },
    {
      product_id: snapshot.product_id,
      handle: snapshot.handle,
      action: "SALES_CHANNEL_DETACH",
      status: channelIds.length === 0 ? "no_op" : status,
      executed: false,
      db_writes: 0,
      detail: {
        current_sales_channel_ids: channelIds,
        current_sales_channel_names: snapshot.sales_channels
          .map((c) => c.name)
          .filter((n): n is string => typeof n === "string"),
        expected_remaining_relations: 0,
      },
    },
    {
      product_id: snapshot.product_id,
      handle: snapshot.handle,
      action: "PROJECTION_REMOVE_OR_HIDE",
      status: snapshot.projection ? status : "no_op",
      executed: false,
      db_writes: 0,
      detail: {
        current_projection_exists: snapshot.projection !== null,
        projection_id: snapshot.projection?.id ?? null,
        projection_action: snapshot.projection ? "remove" : "none",
      },
    },
  ]
}
