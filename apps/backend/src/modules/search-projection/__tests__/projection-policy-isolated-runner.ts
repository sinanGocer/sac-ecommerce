/* eslint-disable no-console */
import assert from "assert"

import {
  isProjectableStatus,
  PROJECTABLE_PRODUCT_STATUSES,
  PROJECTION_POLICY_VERSION,
} from "../projection-policy"
import { PersistedProjection } from "../services/projection-comparator"
import { ProjectionWriter } from "../services/projection-writer"
import { SearchProjection } from "../search-projection.types"

/**
 * jest'siz izole test runner (catalog:test deseninin aynısı). Çalıştırma:
 * npm run search:projection:test
 */
let passed = 0
function ok(cond: unknown, label: string): void {
  assert.ok(cond, label)
  passed++
}

function projectionFor(productId: string, title = "Product"): SearchProjection {
  return {
    product_id: productId,
    external_id: "ext_" + productId,
    handle: productId + "-handle",
    title,
    brand: "Aveda",
    category_ids: ["cat_1"],
    category_path: "Aveda > Şampuan",
    subcategory: null,
    collection: null,
    hair_type: [],
    concerns: [],
    benefits: [],
    size_ml: null,
    vegan: null,
    color_safe: null,
    professional_only: false,
    price: 500,
    currency: "try",
    in_stock: true,
    thumbnail: null,
    average_rating: null,
    review_count: 0,
    weekly_sales_score: 0,
    monthly_sales_score: 0,
    all_time_sales_score: 0,
    favorite_score: 0,
    trending_score: 0,
    created_at: null,
    updated_at: null,
    source_created_at: "2026-06-22T10:00:00.000Z",
    source_updated_at: "2026-06-22T11:00:00.000Z",
    metadata_version: 2,
    projection_schema_version: 1,
  }
}

function persistedFor(
  productId: string,
  pspId: string,
  overrides: Partial<PersistedProjection> = {}
): PersistedProjection {
  const p = projectionFor(productId)
  return {
    id: pspId,
    ...p,
    source_created_at: new Date(p.source_created_at!),
    source_updated_at: new Date(p.source_updated_at!),
    price: "500",
    ...overrides,
  }
}

interface FakeService {
  store: Map<string, PersistedProjection>
  calls: { create: number; update: number; delete: number; deletedIds: string[] }
  listProductSearchProjections(
    filter: { product_id: string[] },
    config: { select: string[]; take: number }
  ): Promise<PersistedProjection[]>
  createProductSearchProjections(data: Array<{ product_id: string }>): Promise<unknown>
  updateProductSearchProjections(data: Array<{ id: string }>): Promise<unknown>
  deleteProductSearchProjections(ids: string[]): Promise<unknown>
}

function makeService(initial: PersistedProjection[] = []): FakeService {
  const store = new Map<string, PersistedProjection>()
  for (const row of initial) store.set(row.product_id, row)
  const calls = { create: 0, update: 0, delete: 0, deletedIds: [] as string[] }
  return {
    store,
    calls,
    async listProductSearchProjections(filter) {
      const ids = filter.product_id
      return [...store.values()].filter((r) => ids.includes(r.product_id))
    },
    async createProductSearchProjections(data) {
      calls.create++
      for (const d of data) {
        store.set(d.product_id, persistedFor(d.product_id, "psp_new_" + d.product_id))
      }
      return []
    },
    async updateProductSearchProjections() {
      calls.update++
      return []
    },
    async deleteProductSearchProjections(ids) {
      calls.delete++
      calls.deletedIds.push(...ids)
      for (const id of ids) {
        for (const [key, value] of store) {
          if (value.id === id) store.delete(key)
        }
      }
      return []
    },
  }
}

// syncBatch interface ile uyumlu service kabuğu (writer'ın beklediği şekil).
function writerOf(service: FakeService): ProjectionWriter {
  return new ProjectionWriter(service as never)
}

async function main(): Promise<void> {
  // policy doğrulaması
  ok(PROJECTION_POLICY_VERSION === 2, "policy version 2")
  ok(
    isProjectableStatus("published") &&
      !isProjectableStatus("draft") &&
      !isProjectableStatus("proposed") &&
      !isProjectableStatus("rejected") &&
      !isProjectableStatus(null) &&
      !isProjectableStatus(undefined),
    "8/9 isProjectableStatus: only published"
  )
  ok(
    (PROJECTABLE_PRODUCT_STATUSES as readonly string[]).join(",") === "published",
    "projectable statuses = [published]"
  )

  // 1) Published + projection yok → create
  {
    const svc = makeService([])
    const res = await writerOf(svc).syncBatch([projectionFor("prod_1")], [])
    ok(
      res.created === 1 && res.deleted === 0 && res.db_writes === 1 && svc.calls.create === 1,
      "1 published no projection → create"
    )
  }

  // 2) Published + projection var, aynı → unchanged
  {
    const svc = makeService([persistedFor("prod_1", "psp_1")])
    const res = await writerOf(svc).syncBatch([projectionFor("prod_1")], [])
    ok(
      res.unchanged === 1 && res.created === 0 && res.updated === 0 && res.db_writes === 0,
      "2 published unchanged"
    )
  }

  // 3) Published + projection stale → update
  {
    const svc = makeService([persistedFor("prod_1", "psp_1", { title: "Old" })])
    const res = await writerOf(svc).syncBatch([projectionFor("prod_1")], [])
    ok(res.updated === 1 && res.db_writes === 1 && svc.calls.update === 1, "3 published stale → update")
  }

  // 4) Draft + projection yok → no-op
  {
    const svc = makeService([])
    const res = await writerOf(svc).syncBatch([], ["prod_draft"])
    ok(
      res.deleted === 0 && res.db_writes === 0 && svc.calls.delete === 0,
      "4 draft no projection → no-op"
    )
  }

  // 5) Draft + projection var → delete planned (dry-run yazmaz)
  {
    const svc = makeService([persistedFor("prod_draft", "psp_draft")])
    const res = await writerOf(svc).syncBatch([], ["prod_draft"], { dryRun: true })
    ok(
      res.deleted === 1 && res.db_writes === 0 && svc.calls.delete === 0 && svc.store.size === 1,
      "5 draft projection delete planned (dry-run no write)"
    )
  }

  // 6) Draft delete commit → targeted projection delete
  {
    const svc = makeService([persistedFor("prod_draft", "psp_draft")])
    const res = await writerOf(svc).syncBatch([], ["prod_draft"])
    ok(
      res.deleted === 1 &&
        res.db_writes === 1 &&
        svc.calls.delete === 1 &&
        svc.calls.deletedIds[0] === "psp_draft" &&
        svc.store.size === 0,
      "6 draft commit → targeted delete"
    )

    // 7) İkinci çalışma → no-op
    const res2 = await writerOf(svc).syncBatch([], ["prod_draft"])
    ok(res2.deleted === 0 && res2.db_writes === 0, "7 second run → no-op")
  }

  // 10) Allowlist/scope dışı draft projection silinmez
  {
    // store'da prod_other'a ait projection var ama removable listesinde yok → dokunulmaz
    const svc = makeService([
      persistedFor("prod_draft", "psp_draft"),
      persistedFor("prod_other", "psp_other"),
    ])
    const res = await writerOf(svc).syncBatch([], ["prod_draft"])
    ok(
      res.deleted === 1 &&
        svc.store.has("prod_other") &&
        !svc.store.has("prod_draft"),
      "10 scope dışı projection silinmez"
    )
  }

  // 11) Tam backfill: yalnız scope içindeki stale projection kaldırılır + published upsert
  {
    const svc = makeService([
      persistedFor("prod_pub", "psp_pub"), // published unchanged
      persistedFor("prod_draft", "psp_draft"), // draft → delete
      persistedFor("prod_keep", "psp_keep"), // scope dışı → korunur
    ])
    const res = await writerOf(svc).syncBatch(
      [projectionFor("prod_pub")],
      ["prod_draft"]
    )
    ok(
      res.unchanged === 1 &&
        res.deleted === 1 &&
        svc.store.has("prod_keep") &&
        svc.store.has("prod_pub") &&
        !svc.store.has("prod_draft"),
      "11 full backfill scope-bound cleanup"
    )
  }

  // 12) Dry-run create+delete yazmaz
  {
    const svc = makeService([persistedFor("prod_draft", "psp_draft")])
    const res = await writerOf(svc).syncBatch(
      [projectionFor("prod_new")],
      ["prod_draft"],
      { dryRun: true }
    )
    ok(
      res.created === 1 &&
        res.deleted === 1 &&
        res.db_writes === 0 &&
        svc.calls.create === 0 &&
        svc.calls.delete === 0,
      "12 dry-run no writes"
    )
  }

  // 18) Raw SQL yok (modül + writer + backfill)
  noSqlGuard()

  console.log(`PROJECTION POLICY ISOLATED TESTS: ${passed} PASSED`)
}

function noSqlGuard(): void {
  const fs = require("fs") as typeof import("fs")
  const path = require("path") as typeof import("path")
  const sqlPattern = /\b(SELECT|INSERT|UPDATE|DELETE|DROP)\s+.*\b(FROM|INTO|TABLE|WHERE|SET)\b/i
  const targets = [
    "src/modules/search-projection/projection-policy.ts",
    "src/modules/search-projection/services/projection-writer.ts",
    "src/modules/search-projection/scripts/search-backfill.ts",
    "src/modules/search-projection/projection-mapper.ts",
  ]
  for (const rel of targets) {
    const content = fs.readFileSync(path.resolve(process.cwd(), rel), "utf-8")
    ok(!sqlPattern.test(content), `no raw SQL in ${rel}`)
  }
  const backfill = fs.readFileSync(
    path.resolve(process.cwd(), "src/modules/search-projection/scripts/search-backfill.ts"),
    "utf-8"
  )
  ok(/query\.graph/.test(backfill), "backfill uses query.graph")
  ok(/syncBatch/.test(backfill), "backfill uses policy-aware syncBatch")
}

main().catch((e) => {
  console.error("PROJECTION TEST FAILED:", e instanceof Error ? e.message : e)
  process.exit(1)
})
