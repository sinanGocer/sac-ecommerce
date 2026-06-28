import {
  ALLOWLISTED_SEED_PRODUCTS,
  ProductReferenceCounts,
  SALON_SEED_CLEANUP_POLICY_VERSION,
  SeedProductSnapshot,
} from "./salon-seed-cleanup-policy"
import { SalonSeedCleanupPlan } from "./salon-seed-cleanup-service"

export interface SalonSeedCleanupReport {
  run_id: string
  started_at: string
  finished_at: string
  mode: "dry-run"
  policy_version: number
  allowlisted_products: typeof ALLOWLISTED_SEED_PRODUCTS
  matched_product_ids: string[]
  missing_product_ids: string[]
  unexpected_product_ids: string[]
  products: Array<{
    product_id: string
    handle: string | null
    title: string | null
    status: string
    sales_channel_count: number
    projection_exists: boolean
    reference_counts: ProductReferenceCounts
  }>
  reference_gate: {
    ok: boolean
    blocked_product_ids: string[]
    blockers: SalonSeedCleanupPlan["blockers"]
  }
  planned_actions: SalonSeedCleanupPlan["planned_actions"]
  plan_fingerprint: string | null
  db_writes: 0
  final_decision: SalonSeedCleanupPlan["decision"]
  errors: string[]
}

export function buildSalonSeedCleanupReport(params: {
  runId: string
  startedAt: string
  finishedAt: string
  snapshots: SeedProductSnapshot[]
  countsByProductId: Record<string, ProductReferenceCounts>
  plan: SalonSeedCleanupPlan
}): SalonSeedCleanupReport {
  return {
    run_id: params.runId,
    started_at: params.startedAt,
    finished_at: params.finishedAt,
    mode: "dry-run",
    policy_version: SALON_SEED_CLEANUP_POLICY_VERSION,
    allowlisted_products: ALLOWLISTED_SEED_PRODUCTS,
    matched_product_ids: params.plan.matched_product_ids,
    missing_product_ids: params.plan.missing_product_ids,
    unexpected_product_ids: params.plan.unexpected_product_ids,
    products: params.snapshots.map((snapshot) => ({
      product_id: snapshot.product_id,
      handle: snapshot.handle,
      title: snapshot.title,
      status: snapshot.status,
      sales_channel_count: snapshot.sales_channels.length,
      projection_exists: snapshot.projection !== null,
      reference_counts: params.countsByProductId[snapshot.product_id],
    })),
    reference_gate: {
      ok: params.plan.blocked_product_ids.length === 0,
      blocked_product_ids: params.plan.blocked_product_ids,
      blockers: params.plan.blockers,
    },
    planned_actions: params.plan.planned_actions,
    plan_fingerprint: params.plan.plan_fingerprint,
    db_writes: 0,
    final_decision: params.plan.decision,
    errors: params.plan.errors,
  }
}
