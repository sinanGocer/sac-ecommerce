/**
 * User-Assisted Import — SAF orkestrasyon (IO yok, dry-run).
 *
 * parse → extract → compare → plan + fingerprint. DB/workflow ÇAĞIRMAZ;
 * db_writes her zaman 0. Gerçek import ayrı commit yolu (bu fazda yok).
 */

import {
  AssistedImportDecision,
  ASSISTED_IMPORT_POLICY_VERSION,
  ExistingProductRef,
  ExtractedProduct,
  ImportInputRecord,
  PlannedImportItem,
} from "./assisted-import-policy"
import { compareToExisting, summarize } from "./assisted-import-compare"
import { extractFromHtml, extractFromRecord } from "./assisted-import-extract"
import {
  buildImportFingerprintPayload,
  computeImportFingerprint,
  ImportFingerprintPayload,
} from "./assisted-import-fingerprint"

export interface AssistedImportInput {
  records: ImportInputRecord[]
  existing: ExistingProductRef[]
}

export interface AssistedImportPlan {
  decision: AssistedImportDecision
  extracted_count: number
  items: PlannedImportItem[]
  summary: Record<string, number>
  fingerprint_payload: ImportFingerprintPayload
  plan_fingerprint: string
  total_db_writes: 0
}

export function planAssistedImport(input: AssistedImportInput): AssistedImportPlan {
  const extracted: ExtractedProduct[] = input.records.map((r) =>
    r.source_format === "html" && r.html
      ? extractFromHtml(r.html, r.ref)
      : extractFromRecord(r)
  )

  const items = compareToExisting({ extracted, existing: input.existing })
  const summary = summarize(items)
  const fpPayload = buildImportFingerprintPayload(ASSISTED_IMPORT_POLICY_VERSION, items)

  let decision: AssistedImportDecision = "ASSISTED_IMPORT_DRY_RUN_READY"
  if (input.records.length === 0) decision = "ASSISTED_IMPORT_EMPTY_INPUT"

  return {
    decision,
    extracted_count: extracted.length,
    items,
    summary,
    fingerprint_payload: fpPayload,
    plan_fingerprint: computeImportFingerprint(fpPayload),
    total_db_writes: 0,
  }
}
