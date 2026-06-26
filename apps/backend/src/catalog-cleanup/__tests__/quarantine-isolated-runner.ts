/* eslint-disable no-console */
import assert from "assert"

import {
  computePlanFingerprint,
  isConfirmationValid,
  QuarantineFingerprintPayload,
} from "../quarantine-fingerprint"
import {
  buildPlannedActions,
  evaluateAllowlist,
  evaluateIdentity,
  evaluateReferences,
} from "../quarantine-plan"
import {
  ALLOWLISTED_PRODUCT_ID,
  EXPECTED_IDENTITY,
  ProductSnapshot,
  QUARANTINE_POLICY_VERSION,
  ReferenceCounts,
} from "../quarantine-policy"
import { buildReport } from "../quarantine-report"
import { planQuarantine } from "../quarantine-service"
import { PROJECTION_POLICY_VERSION } from "../../modules/search-projection/projection-policy"

/** Önceki adımda (projection guard ÖNCESİ) üretilmiş quarantine fingerprint. */
const OLD_PRE_GUARD_FINGERPRINT = "c1f25398e7ac8f49"

/**
 * jest'siz izole test runner (catalog:test deseninin aynısı). Çalıştırma:
 * npm run catalog:quarantine:test
 */
let passed = 0
function ok(cond: unknown, label: string): void {
  assert.ok(cond, label)
  passed++
}

// ── Sağlam (geçerli) snapshot + sayaçlar ─────────────────────────────────────
function validSnapshot(overrides: Partial<ProductSnapshot> = {}): ProductSnapshot {
  return {
    product_id: ALLOWLISTED_PRODUCT_ID,
    title: EXPECTED_IDENTITY.title,
    status: "published",
    metadata: {
      external_id: "102748",
      brand: "Aveda",
      metadata_version: 2,
      sync_provider: "aveda",
      source_url:
        "https://www.aveda.com.tr/product/102748/102748/sac-bakim/sac-bakim-maskeleri/color-renewaltm-sac-rengi-canlandiran",
    },
    variant_skus: ["VC9001"],
    sales_channels: [{ id: "sc_default", name: "Default Sales Channel" }],
    projection: { id: "psp_1", product_id: ALLOWLISTED_PRODUCT_ID },
    ...overrides,
  }
}

function validCounts(overrides: Partial<ReferenceCounts> = {}): ReferenceCounts {
  return {
    active_cart_lines: 1,
    completed_cart_lines: 0,
    order_lines: 0,
    order_items: 0,
    inventory_relations: 0,
    variant_count: 1,
    price_count: 1,
    image_count: 1,
    sales_channel_relations: 1,
    category_relations: 1,
    projection_count: 1,
    ...overrides,
  }
}

function run(
  matched: string[],
  snapshot: ProductSnapshot | null,
  counts: ReferenceCounts | null,
  requested = ALLOWLISTED_PRODUCT_ID
) {
  return planQuarantine({
    requestedProductId: requested,
    matchedProductIds: matched,
    snapshot,
    counts,
  })
}

function noSqlGuard(): void {
  // 18) Raw SQL kullanılmıyor — kaynak dosyalarda SQL anahtar kelimesi yok.
  const fs = require("fs") as typeof import("fs")
  const path = require("path") as typeof import("path")
  // Kaynak ağacından okunur (derleme çıktısından değil): cwd = apps/backend.
  const dir = path.resolve(process.cwd(), "src", "catalog-cleanup")
  const files = fs
    .readdirSync(dir)
    .filter((f: string) => f.endsWith(".ts"))
  const sqlPattern = /\b(SELECT|INSERT|UPDATE|DELETE|DROP)\s+.*\b(FROM|INTO|TABLE|WHERE|SET)\b/i
  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), "utf-8")
    ok(!sqlPattern.test(content), `no raw SQL in ${file}`)
  }
  // script de raw SQL içermemeli
  const scriptPath = path.resolve(
    process.cwd(),
    "src",
    "scripts",
    "catalog-product-quarantine.ts"
  )
  const script = fs.readFileSync(scriptPath, "utf-8")
  ok(!sqlPattern.test(script), "no raw SQL in catalog-product-quarantine.ts")
  ok(/query\.graph/.test(script), "script uses query.graph (Medusa public layer)")
}

function main(): void {
  // 1) Doğru tek product ID → plan üretilir, DRY_RUN_READY
  const happy = run([ALLOWLISTED_PRODUCT_ID], validSnapshot(), validCounts())
  ok(
    happy.decision === "QUARANTINE_DRY_RUN_READY" &&
      happy.allowlist.requested_count === 1 &&
      happy.allowlist.matched_count === 1 &&
      happy.plan_fingerprint !== null &&
      happy.actions.length === 3,
    "1 happy path plan"
  )

  // 2) Product bulunamaz → fail-closed PLAN_BLOCKED
  const notFound = run([], null, null)
  ok(
    notFound.decision === "QUARANTINE_PLAN_BLOCKED" &&
      notFound.allowlist.reason === "product_not_found" &&
      notFound.plan_fingerprint === null,
    "2 not found blocked"
  )

  // 3) Birden fazla match → fail-closed
  const multi = run([ALLOWLISTED_PRODUCT_ID, "prod_other"], validSnapshot(), validCounts())
  ok(
    multi.decision === "QUARANTINE_PLAN_BLOCKED" &&
      multi.allowlist.reason === "multiple_matches",
    "3 multi match blocked"
  )

  // 4) External ID mismatch → stale plan
  const extMismatch = run(
    [ALLOWLISTED_PRODUCT_ID],
    validSnapshot({ metadata: { ...validSnapshot().metadata, external_id: "999999" } }),
    validCounts()
  )
  ok(
    extMismatch.decision === "QUARANTINE_STALE_PLAN" &&
      extMismatch.errors.includes("identity:external_id"),
    "4 external id stale"
  )

  // 5) SKU mismatch → stale plan
  const skuMismatch = run(
    [ALLOWLISTED_PRODUCT_ID],
    validSnapshot({ variant_skus: ["OTHER"] }),
    validCounts()
  )
  ok(
    skuMismatch.decision === "QUARANTINE_STALE_PLAN" &&
      skuMismatch.errors.includes("identity:sku"),
    "5 sku stale"
  )

  // 6) Source URL mismatch → stale plan
  const urlMismatch = run(
    [ALLOWLISTED_PRODUCT_ID],
    validSnapshot({
      metadata: { ...validSnapshot().metadata, source_url: "https://evil.example.com/x" },
    }),
    validCounts()
  )
  ok(
    urlMismatch.decision === "QUARANTINE_STALE_PLAN" &&
      urlMismatch.errors.some((e) => e.startsWith("identity:source_url")),
    "6 source url stale"
  )

  // 7) Aktif cart line var → unpublish allowed, delete denied
  const refs = evaluateReferences(validCounts({ active_cart_lines: 1 }))
  ok(
    refs.unpublish_allowed === true &&
      refs.delete_allowed === false &&
      refs.delete_would_be_safe === false &&
      refs.delete_blockers.includes("active_cart_lines"),
    "7 cart line: unpublish ok delete denied"
  )

  // 8) Order reference var → delete denied
  const orderRefs = evaluateReferences(
    validCounts({ active_cart_lines: 0, order_lines: 2, order_items: 3 })
  )
  ok(
    orderRefs.delete_would_be_safe === false &&
      orderRefs.delete_blockers.includes("order_lines") &&
      orderRefs.order_reference_count === 5,
    "8 order ref delete denied"
  )

  // 9) Dry-run → planlı aksiyonlar executed=false, db_writes=0
  ok(
    happy.actions.every((a) => a.executed === false && a.db_writes === 0),
    "9 dry-run no execution"
  )

  // 10) Yanlış confirmation token → reddedilir
  ok(
    !isConfirmationValid("wrong-token", happy.plan_fingerprint!) &&
      !isConfirmationValid(null, happy.plan_fingerprint!) &&
      isConfirmationValid(happy.plan_fingerprint!, happy.plan_fingerprint!),
    "10 confirmation token check"
  )

  // 11) Aynı payload → aynı fingerprint
  const payload: QuarantineFingerprintPayload = {
    policy_version: QUARANTINE_POLICY_VERSION,
    projection_policy_version: PROJECTION_POLICY_VERSION,
    product_id: ALLOWLISTED_PRODUCT_ID,
    external_id: "102748",
    sku: ["VC9001"],
    current_status: "published",
    target_status: "draft",
    current_sales_channel_ids: ["sc_default"],
    target_sales_channel_ids: [],
    projection_action: "remove",
    active_cart_line_count: 1,
    order_reference_count: 0,
    source_url: "https://www.aveda.com.tr/product/x/color-renewal",
    metadata_version: 2,
  }
  ok(
    computePlanFingerprint(payload) === computePlanFingerprint({ ...payload }),
    "11 deterministic fingerprint"
  )

  // 12) Policy version değişirse fingerprint değişir
  ok(
    computePlanFingerprint(payload) !==
      computePlanFingerprint({ ...payload, policy_version: 99 }),
    "12 policy version changes fingerprint"
  )
  // 14) Projection policy v1/v2 fingerprint'leri farklıdır
  ok(
    computePlanFingerprint({ ...payload, projection_policy_version: 1 }) !==
      computePlanFingerprint({ ...payload, projection_policy_version: 2 }),
    "14 projection policy version changes fingerprint"
  )
  // referans durumu da fingerprint'i değiştirir
  ok(
    computePlanFingerprint(payload) !==
      computePlanFingerprint({ ...payload, active_cart_line_count: 2 }),
    "12b reference state changes fingerprint"
  )

  // 16) Eski (guard öncesi) fingerprint c1f25398e7ac8f49 artık geçersiz
  ok(
    PROJECTION_POLICY_VERSION === 2 &&
      happy.plan_fingerprint !== OLD_PRE_GUARD_FINGERPRINT &&
      !isConfirmationValid(OLD_PRE_GUARD_FINGERPRINT, happy.plan_fingerprint!),
    "16 old pre-guard fingerprint invalid"
  )

  // 13) Sales channel relation zaten yok → SALES_CHANNEL_DETACH no_op
  const noChannel = buildPlannedActions(validSnapshot({ sales_channels: [] }))
  ok(
    noChannel.find((a) => a.action === "SALES_CHANNEL_DETACH")!.status === "no_op",
    "13 sales channel no_op"
  )

  // 14) Projection zaten yok → PROJECTION_REMOVE_OR_HIDE no_op
  const noProjection = buildPlannedActions(validSnapshot({ projection: null }))
  ok(
    noProjection.find((a) => a.action === "PROJECTION_REMOVE_OR_HIDE")!.status === "no_op",
    "14 projection no_op"
  )

  // 15) Product zaten target status (draft) → PRODUCT_UNPUBLISH no_op
  const alreadyDraft = buildPlannedActions(validSnapshot({ status: "draft" }))
  ok(
    alreadyDraft.find((a) => a.action === "PRODUCT_UNPUBLISH")!.status === "no_op",
    "15 product status no_op"
  )

  // 16) Report db_writes: 0 (dry-run)
  const report = buildReport({
    runId: "r1",
    startedAt: "2026-06-26T00:00:00.000Z",
    finishedAt: "2026-06-26T00:00:01.000Z",
    mode: "dry-run",
    snapshot: validSnapshot(),
    counts: validCounts(),
    plan: happy,
    commitEnabled: false,
    dbWrites: 0,
    projectionWrites: 0,
    finalDecision: happy.decision,
    actions: happy.actions,
  })
  ok(
    report.db_writes === 0 &&
      report.projection_writes === 0 &&
      report.commit_enabled === false &&
      report.mode === "dry-run" &&
      report.final_decision === "QUARANTINE_DRY_RUN_READY" &&
      report.commit_command !== null &&
      report.commit_command.includes(happy.plan_fingerprint!),
    "16 report db_writes 0 + commit command"
  )

  // 17) Dry-run'da üç aksiyon yalnız planned/no_op
  const types = report.planned_actions
    .concat(report.skipped_actions)
    .map((a) => a.action)
    .sort()
  ok(
    report.planned_actions.length + report.skipped_actions.length === 3 &&
      types.join(",") ===
        "PRODUCT_UNPUBLISH,PROJECTION_REMOVE_OR_HIDE,SALES_CHANNEL_DETACH" &&
      report.planned_actions.every((a) => a.status === "planned") &&
      report.skipped_actions.every((a) => a.status === "no_op"),
    "17 three actions planned/no_op"
  )

  // ek) allowlist requested mismatch
  const wrongRequest = run(["prod_xyz"], null, null, "prod_xyz")
  ok(
    wrongRequest.decision === "QUARANTINE_PLAN_BLOCKED" &&
      wrongRequest.allowlist.reason === "requested_not_allowlisted",
    "ek requested not allowlisted"
  )

  // ek) identity gate doğrulaması — geçerli kimlik ok
  const idOk = evaluateIdentity(validSnapshot(), EXPECTED_IDENTITY)
  ok(idOk.ok && idOk.mismatches.length === 0, "ek identity ok")

  // ek) allowlist helper
  const al = evaluateAllowlist(ALLOWLISTED_PRODUCT_ID, ALLOWLISTED_PRODUCT_ID, [ALLOWLISTED_PRODUCT_ID])
  ok(al.ok && al.matched_product_id === ALLOWLISTED_PRODUCT_ID, "ek allowlist ok")

  // 18) Raw SQL kullanılmıyor
  noSqlGuard()

  console.log(`CATALOG QUARANTINE ISOLATED TESTS: ${passed} PASSED`)
}

try {
  main()
} catch (e) {
  console.error("QUARANTINE TEST FAILED:", e instanceof Error ? e.message : e)
  process.exit(1)
}
