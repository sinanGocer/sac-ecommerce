import {
  AvedaMetadataV2CommitWriter,
  CommitGuard,
  CurrentProductState,
  mergeApprovedMetadata,
  resolveCommitGuard,
  verifyCommitScope,
} from "../metadata-v2-commit"
import { metadataFingerprint } from "../metadata-v2-fingerprint"
import { ProductV2Plan } from "../metadata-v2.types"

const baseMetadata: Record<string, unknown> = {
  sync_provider: "aveda",
  source_url: "https://aveda/p/1",
  external_id: "111",
  brand: "Aveda",
  sub_category: "legacy",
  custom_admin_note: "koru",
  list_price: 100,
}

function makePlan(over: Partial<ProductV2Plan> = {}): ProductV2Plan {
  return {
    product_id: "prod_1",
    handle: "aveda-1",
    source_url: "https://aveda/p/1",
    external_id: "111",
    identity_match: "full",
    identity_confidence: "high",
    metadata_version_before: null,
    metadata_version_after_proposed: 2,
    status: "ready_for_v2",
    fields_unchanged: [],
    fields_added: ["subcategory"],
    fields_normalized: [],
    fields_conflicted: [],
    fields_rejected: [],
    fields_preserved: [],
    taxonomy_validation_errors: [],
    parser_errors: [],
    missing_source_data: [],
    source_evidence: "test",
    category_relation_change_proposed: false,
    price_untouched: true,
    images_untouched: true,
    variants_untouched: true,
    metadata_fingerprint_before: metadataFingerprint(baseMetadata),
    approved_patch: {
      metadata_version: 2,
      subcategory: "Şampuan",
      color_safe: null,
    },
    diffs: [],
    ...over,
  }
}

function current(
  metadata: Record<string, unknown> = baseMetadata
): CurrentProductState {
  return { id: "prod_1", handle: "aveda-1", metadata }
}

const enabledGuard: CommitGuard = {
  commit_enabled: true,
  dry_run: false,
}

describe("resolveCommitGuard", () => {
  it("default modda DB write açmaz", () => {
    expect(resolveCommitGuard({})).toEqual({
      commit_enabled: false,
      dry_run: true,
    })
  })

  it("yalnız commit=true yeterli değildir", () => {
    expect(
      resolveCommitGuard({ AVEDA_METADATA_V2_COMMIT: "true" }).commit_enabled
    ).toBe(false)
  })

  it("yalnız dry_run=false yeterli değildir", () => {
    expect(
      resolveCommitGuard({ AVEDA_METADATA_V2_DRY_RUN: "false" }).commit_enabled
    ).toBe(false)
  })

  it("iki koşul birlikte commit açar", () => {
    expect(
      resolveCommitGuard({
        AVEDA_METADATA_V2_COMMIT: "true",
        AVEDA_METADATA_V2_DRY_RUN: "false",
      })
    ).toEqual({ commit_enabled: true, dry_run: false })
  })
})

describe("verifyCommitScope — commit scope fail-closed", () => {
  it("5/5 eşleşmiş, missing yok → ok", () => {
    expect(
      verifyCommitScope({
        requested_external_ids: 5,
        matched_external_ids: 5,
        missing_external_ids: [],
      })
    ).toEqual({ ok: true, reason: null })
  })
  it("scope yok (allowlist'siz plan) → fail-closed", () => {
    expect(verifyCommitScope(null).ok).toBe(false)
    expect(verifyCommitScope(undefined).reason).toBe("scope_missing")
  })
  it("eksik requested id → fail-closed", () => {
    expect(
      verifyCommitScope({
        requested_external_ids: 5,
        matched_external_ids: 4,
        missing_external_ids: ["71184"],
      }).reason
    ).toBe("missing_requested_ids")
  })
  it("sayı uyuşmazlığı → fail-closed", () => {
    expect(
      verifyCommitScope({
        requested_external_ids: 5,
        matched_external_ids: 3,
        missing_external_ids: [],
      }).reason
    ).toBe("scope_count_mismatch")
  })
  it("boş scope → fail-closed", () => {
    expect(
      verifyCommitScope({
        requested_external_ids: 0,
        matched_external_ids: 0,
        missing_external_ids: [],
      }).reason
    ).toBe("empty_scope")
  })
})

describe("metadata merge policy", () => {
  it("manuel metadata ve legacy sub_category alanını korur", () => {
    const merged = mergeApprovedMetadata(baseMetadata, {
      metadata_version: 2,
      subcategory: "Şampuan",
    })
    expect(merged.custom_admin_note).toBe("koru")
    expect(merged.sub_category).toBe("legacy")
    expect(merged.subcategory).toBe("Şampuan")
  })

  it("null kaynak mevcut dolu alanı silmez", () => {
    const merged = mergeApprovedMetadata(
      { ...baseMetadata, color_safe: true },
      { color_safe: null }
    )
    expect(merged.color_safe).toBe(true)
  })

  it("sync-owned olmayan ve ürün alanlarını patch etmez", () => {
    const merged = mergeApprovedMetadata(baseMetadata, {
      title: "değişmesin",
      price: 1,
      images: ["x"],
      variants: ["x"],
      subcategory: "Şampuan",
    })
    expect(merged.title).toBeUndefined()
    expect(merged.price).toBeUndefined()
    expect(merged.images).toBeUndefined()
    expect(merged.variants).toBeUndefined()
    expect(merged.subcategory).toBe("Şampuan")
  })
})

describe("AvedaMetadataV2CommitWriter", () => {
  it("guard kapalıysa updater çağırmaz", async () => {
    let calls = 0
    const writer = new AvedaMetadataV2CommitWriter(async () => {
      calls++
    })
    await expect(
      writer.execute(
        [makePlan()],
        new Map([["prod_1", current()]]),
        { commit_enabled: false, dry_run: true }
      )
    ).rejects.toThrow("commit kilitli")
    expect(calls).toBe(0)
  })

  it("ready ürün yalnız merged metadata ile güncellenir", async () => {
    const writes: Record<string, unknown>[] = []
    const writer = new AvedaMetadataV2CommitWriter(async (_id, metadata) => {
      writes.push(metadata)
    })
    const report = await writer.execute(
      [makePlan()],
      new Map([["prod_1", current()]]),
      enabledGuard
    )
    expect(report.totals.updated).toBe(1)
    expect(report.totals.db_writes).toBe(1)
    expect(writes[0].custom_admin_note).toBe("koru")
    expect(writes[0].list_price).toBe(100)
    expect(writes[0].subcategory).toBe("Şampuan")
    expect(writes[0].metadata_version).toBe(2)
  })

  it("needs_review ve rejected planları atlar", async () => {
    let calls = 0
    const writer = new AvedaMetadataV2CommitWriter(async () => {
      calls++
    })
    const report = await writer.execute(
      [
        makePlan({ status: "needs_review" }),
        makePlan({ product_id: "prod_2", status: "rejected" }),
      ],
      new Map([["prod_1", current()]]),
      enabledGuard
    )
    expect(report.totals.skipped).toBe(2)
    expect(report.totals.db_writes).toBe(0)
    expect(calls).toBe(0)
  })

  it("source_url mismatch stale_plan üretir", async () => {
    const changed = {
      ...baseMetadata,
      source_url: "https://aveda/p/changed",
    }
    const report = await new AvedaMetadataV2CommitWriter(async () => {}).execute(
      [makePlan()],
      new Map([["prod_1", current(changed)]]),
      enabledGuard
    )
    expect(report.products[0].status).toBe("stale_plan")
    expect(report.products[0].error).toBe("source_url_mismatch")
  })

  it("external_id mismatch stale_plan üretir", async () => {
    const changed = { ...baseMetadata, external_id: "changed" }
    const report = await new AvedaMetadataV2CommitWriter(async () => {}).execute(
      [makePlan()],
      new Map([["prod_1", current(changed)]]),
      enabledGuard
    )
    expect(report.products[0].status).toBe("stale_plan")
    expect(report.products[0].error).toBe("external_id_mismatch")
  })

  it("brand değişmişse stale_plan üretir", async () => {
    const changed = { ...baseMetadata, brand: "Başka Marka" }
    const report = await new AvedaMetadataV2CommitWriter(async () => {}).execute(
      [makePlan()],
      new Map([["prod_1", current(changed)]]),
      enabledGuard
    )
    expect(report.products[0].status).toBe("stale_plan")
    expect(report.products[0].error).toBe("brand_mismatch")
  })

  it("metadata fingerprint değişirse stale_plan üretir", async () => {
    const changed = { ...baseMetadata, custom_admin_note: "sonradan değişti" }
    const report = await new AvedaMetadataV2CommitWriter(async () => {}).execute(
      [makePlan()],
      new Map([["prod_1", current(changed)]]),
      enabledGuard
    )
    expect(report.products[0].status).toBe("stale_plan")
    expect(report.products[0].error).toBe("metadata_fingerprint_mismatch")
  })

  it("aynı patch ikinci çalıştırmada unchanged olur", async () => {
    const applied = mergeApprovedMetadata(
      baseMetadata,
      makePlan().approved_patch
    )
    const plan = makePlan({
      metadata_version_before: 2,
      metadata_fingerprint_before: metadataFingerprint(applied),
    })
    let calls = 0
    const report = await new AvedaMetadataV2CommitWriter(async () => {
      calls++
    }).execute(
      [plan],
      new Map([["prod_1", current(applied)]]),
      enabledGuard
    )
    expect(report.products[0].status).toBe("unchanged")
    expect(report.totals.db_writes).toBe(0)
    expect(calls).toBe(0)
  })

  it("bir ürün failed olsa da diğer güvenli ürün raporlanır", async () => {
    const secondMetadata = {
      ...baseMetadata,
      source_url: "https://aveda/p/2",
      external_id: "222",
    }
    const secondPlan = makePlan({
      product_id: "prod_2",
      handle: "aveda-2",
      source_url: "https://aveda/p/2",
      external_id: "222",
      metadata_fingerprint_before: metadataFingerprint(secondMetadata),
    })
    const writer = new AvedaMetadataV2CommitWriter(async (id) => {
      if (id === "prod_1") throw new Error("write failed")
    })
    const report = await writer.execute(
      [makePlan(), secondPlan],
      new Map([
        ["prod_1", current()],
        [
          "prod_2",
          { id: "prod_2", handle: "aveda-2", metadata: secondMetadata },
        ],
      ]),
      enabledGuard
    )
    expect(report.totals.failed).toBe(1)
    expect(report.totals.updated).toBe(1)
    expect(report.totals.db_writes).toBe(1)
  })
})
