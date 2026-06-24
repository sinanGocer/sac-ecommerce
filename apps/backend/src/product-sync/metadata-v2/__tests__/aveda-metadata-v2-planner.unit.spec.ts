import {
  AvedaMetadataV2Planner,
  isLegacyMetadata,
} from "../aveda-metadata-v2-planner.service"

const identity = {
  sync_provider: "aveda",
  brand: "Aveda",
  source_url:
    "https://www.aveda.com.tr/product/123/456/sac-sekillendirme/fon-spreyi/speed-of-light-isdan-koruyucu-sac-spreyi",
  external_id: "456",
}

function queryFor(metadata: Record<string, unknown>) {
  return {
    graph: async () => ({
      data: [
        {
          id: "prod_1",
          handle: "speed-of-light-isdan-koruyucu-sac-spreyi",
          title: "Speed of Light Isıdan Koruyucu Saç Spreyi",
          description: "Isıdan koruyucu ve pürüzsüzleştirici saç spreyi.",
          metadata,
        },
      ],
    }),
  }
}

describe("AvedaMetadataV2Planner source reconciliation", () => {
  it("yalnız sürümsüz/V1 ve canonical path'siz ürünü legacy kabul eder", () => {
    expect(isLegacyMetadata({ category: "sac-sekillendirme" })).toBe(true)
    expect(
      isLegacyMetadata({
        metadata_version: 1,
        category: "sac-sekillendirme",
      })
    ).toBe(true)
    expect(
      isLegacyMetadata({
        metadata_version: 1,
        category_path: "Aveda > Şekillendirici > Isı Koruyucu",
      })
    ).toBe(false)
    expect(
      isLegacyMetadata({
        metadata_version: 2,
        category: "Şekillendirici",
      })
    ).toBe(false)
  })

  it("legacy üründe metadata.category source fallback olmaya devam eder", async () => {
    const report = await new AvedaMetadataV2Planner(
      queryFor({
        ...identity,
        category: "sac-sekillendirme",
        sub_category: "fon-spreyi",
      })
    ).plan()

    const product = report.products[0]
    expect(product.status).toBe("ready_for_v2")
    expect(product.source_evidence).toContain("legacy_metadata_category")
    expect(product.approved_patch.category).toBe("Şekillendirici")
    expect(product.approved_patch.subcategory).toBe("Isı Koruyucu")
  })

  it("V2 + source_category yoksa canonical alanları korur ve yeniden türetmez", async () => {
    const metadata = {
      ...identity,
      metadata_version: 2,
      category: "Şekillendirici",
      sub_category: "fon-spreyi",
      subcategory: "Isı Koruyucu",
      category_path: "Aveda > Şekillendirici > Isı Koruyucu",
      category_external_id:
        "product-catalog:category:aveda/sekillendirici/isi-koruyucu",
      hair_type: ["dry"],
      concerns: [
        "heat_protection",
        "dryness_hydration",
        "frizz_smoothing",
      ],
      benefits: ["smoothing", "heat_protection"],
    }
    const report = await new AvedaMetadataV2Planner(queryFor(metadata)).plan()
    const product = report.products[0]

    expect(product.status).toBe("ready_for_v2")
    expect(product.source_evidence).toContain(
      "preserved_canonical_v2_without_source_category"
    )
    expect(product.fields_conflicted).toEqual([])
    expect(product.approved_patch).toEqual({ metadata_version: 2 })
    expect(product.fields_unchanged).toEqual(
      expect.arrayContaining([
        "category",
        "subcategory",
        "category_path",
        "category_external_id",
        "hair_type",
        "concerns",
        "benefits",
      ])
    )
  })

  it("V2 üründe açık source_category varsa normal doğrulama sürer", async () => {
    const report = await new AvedaMetadataV2Planner(
      queryFor({
        ...identity,
        metadata_version: 2,
        source_category: "sac-sekillendirme",
        source_subcategory: "fon-spreyi",
        category: "Şekillendirici",
        subcategory: "Isı Koruyucu",
        category_path: "Aveda > Şekillendirici > Isı Koruyucu",
        category_external_id:
          "product-catalog:category:aveda/sekillendirici/isi-koruyucu",
        hair_type: ["dry"],
        concerns: [
          "heat_protection",
          "dryness_hydration",
          "frizz_smoothing",
        ],
        benefits: ["smoothing", "heat_protection"],
      })
    ).plan()

    expect(report.products[0].source_evidence).toContain(
      "stored_source_category"
    )
  })
})
