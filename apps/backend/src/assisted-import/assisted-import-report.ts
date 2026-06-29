/**
 * User-Assisted Import — rapor (SAF).
 */

import { ASSISTED_IMPORT_POLICY_VERSION } from "./assisted-import-policy"
import { AssistedImportPlan } from "./assisted-import-service"

export interface AssistedImportReport {
  run_id: string
  started_at: string
  finished_at: string
  mode: "dry-run"
  policy_version: number
  input_file: string
  input_format: string
  existing_product_count: number
  extracted_count: number
  summary: Record<string, number>
  items: AssistedImportPlan["items"]
  plan_fingerprint: string
  db_writes: 0
  actual_mutations: 0
  final_decision: AssistedImportPlan["decision"]
  /** Gerçek import komutu (ÇALIŞTIRILMAZ; token = plan_fingerprint). */
  commit_command: string | null
}

export function buildAssistedImportReport(params: {
  runId: string
  startedAt: string
  finishedAt: string
  inputFile: string
  inputFormat: string
  existingCount: number
  plan: AssistedImportPlan
}): AssistedImportReport {
  const { plan } = params
  const importable =
    (plan.summary.new ?? 0) + (plan.summary.update ?? 0) > 0

  return {
    run_id: params.runId,
    started_at: params.startedAt,
    finished_at: params.finishedAt,
    mode: "dry-run",
    policy_version: ASSISTED_IMPORT_POLICY_VERSION,
    input_file: params.inputFile,
    input_format: params.inputFormat,
    existing_product_count: params.existingCount,
    extracted_count: plan.extracted_count,
    summary: plan.summary,
    items: plan.items,
    plan_fingerprint: plan.plan_fingerprint,
    db_writes: 0,
    actual_mutations: 0,
    final_decision: plan.decision,
    commit_command:
      plan.decision === "ASSISTED_IMPORT_DRY_RUN_READY" && importable
        ? `ASSISTED_IMPORT_COMMIT=true ASSISTED_IMPORT_CONFIRM=${plan.plan_fingerprint} npm run catalog:assisted-import:commit`
        : null,
  }
}
