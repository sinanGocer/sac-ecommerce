import {
  ALLOWLISTED_SEED_PRODUCTS,
  ProductReferenceCounts,
  SALON_SEED_CLEANUP_POLICY_VERSION,
  SalonSeedCleanupDecision,
  SeedProductSnapshot,
} from "./salon-seed-cleanup-policy"
import { SalonSeedCleanupPlan } from "./salon-seed-cleanup-service"
import { ExecutedSeedAction } from "./salon-seed-cleanup-writer"

export interface SalonSeedCleanupReport {
  run_id: string
  started_at: string
  finished_at: string
  mode: "dry-run" | "commit"
  commit_enabled: boolean
  commit_confirmed: boolean
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
  executed_actions: ExecutedSeedAction[]
  plan_fingerprint: string | null
  db_writes: number
  projection_writes: number
  final_decision: SalonSeedCleanupDecision
  errors: string[]
}

export function buildSalonSeedCleanupReport(params: {
  runId: string
  startedAt: string
  finishedAt: string
  snapshots: SeedProductSnapshot[]
  countsByProductId: Record<string, ProductReferenceCounts>
  plan: SalonSeedCleanupPlan
  /** Commit-mode opsiyonel alanları (verilmezse saf dry-run, db_writes 0). */
  mode?: "dry-run" | "commit"
  commitEnabled?: boolean
  commitConfirmed?: boolean
  executedActions?: ExecutedSeedAction[]
  dbWrites?: number
  projectionWrites?: number
  finalDecision?: SalonSeedCleanupDecision
}): SalonSeedCleanupReport {
  return {
    run_id: params.runId,
    started_at: params.startedAt,
    finished_at: params.finishedAt,
    mode: params.mode ?? "dry-run",
    commit_enabled: params.commitEnabled ?? false,
    commit_confirmed: params.commitConfirmed ?? false,
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
    executed_actions: params.executedActions ?? [],
    plan_fingerprint: params.plan.plan_fingerprint,
    db_writes: params.dbWrites ?? 0,
    projection_writes: params.projectionWrites ?? 0,
    final_decision: params.finalDecision ?? params.plan.decision,
    errors: params.plan.errors,
  }
}
