import { AvedaMetadataV2Planner } from "../aveda-metadata-v2-planner.service"

/**
 * Planner external_id allowlist (yeni 5 ürünü hedefleme) izole testi.
 * Mock query ile DB'siz çalışır; gerçek offline re-normalization mantığını kullanır.
 */

type Row = {
  id: string
  handle?: string | null
  title?: string | null
  description?: string | null
  metadata?: Record<string, unknown> | null
}

function mockQuery(rows: Row[]) {
  return {
    graph: async () => ({ data: rows }),
  }
}

const avedaRow = (ext: string, extra: Record<string, unknown> = {}): Row => ({
  id: `prod_${ext}`,
  handle: `h-${ext}`,
  title: `Ürün ${ext}`,
  description: null,
  metadata: {
    sync_provider: "aveda",
    external_id: ext,
    source_url: `https://www.aveda.com.tr/product/x/${ext}/sac-bakim/sampuan/p`,
    source_category: "sac-bakim",
    source_subcategory: "sampuan",
    ...extra,
  },
})

const salonRow: Row = {
  id: "prod_salon",
  handle: "salon-1",
  title: "Salon Ürünü",
  description: null,
  metadata: { category: "saç-bakımı" }, // sync_provider yok → Aveda değil
}

describe("AvedaMetadataV2Planner — external_id allowlist hedefleme", () => {
  it("allowlist verilince YALNIZ hedef external_id'ler işlenir; eski/salon kapsam dışı", async () => {
    const rows = [
      avedaRow("62089"),
      avedaRow("99999", { metadata_version: 2 }), // eski V2 — kapsam dışı kalmalı
      salonRow,
    ]
    const planner = new AvedaMetadataV2Planner(
      mockQuery(rows),
      undefined,
      new Set(["62089"])
    )
    const report = await planner.plan()
    expect(report.products.length).toBe(1)
    expect(report.products[0].external_id).toBe("62089")
    expect(report.products[0].product_id).toBe("prod_62089")
    expect(report.scope).toEqual({
      requested_external_ids: 1,
      matched_external_ids: 1,
      missing_external_ids: [],
    })
  })

  it("eksik istenen external_id → scope.missing'te raporlanır", async () => {
    const planner = new AvedaMetadataV2Planner(
      mockQuery([avedaRow("62089")]),
      undefined,
      new Set(["62089", "70000"])
    )
    const report = await planner.plan()
    expect(report.products.length).toBe(1)
    expect(report.scope?.matched_external_ids).toBe(1)
    expect(report.scope?.missing_external_ids).toEqual(["70000"])
  })

  it("allowlist yok → tüm Aveda işlenir, scope null (eski davranış)", async () => {
    const planner = new AvedaMetadataV2Planner(
      mockQuery([avedaRow("62089"), avedaRow("99999"), salonRow])
    )
    const report = await planner.plan()
    expect(report.products.length).toBe(2) // yalnız Aveda olanlar
    expect(report.scope ?? null).toBeNull()
  })
})
