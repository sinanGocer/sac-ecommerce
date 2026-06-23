import {
  buildProductPlan,
  classifyIdentity,
  ProductPlanInput,
} from "../metadata-v2-diff"

const baseProposed = {
  sync_provider: "aveda",
  brand: "Aveda",
  category: "sac-bakim",
  subcategory: "sampuan",
  category_path: "Aveda > sac-bakim > sampuan",
  category_external_id: "product-catalog:category:aveda:sac-bakim:sampuan",
  hair_type: ["kuru"],
  concerns: ["nem"],
  benefits: ["besleyici"],
  size_ml: 250,
  vegan: true,
  color_safe: null,
  source_url: "https://aveda/p/1",
  external_id: "111",
}

function makeInput(over: Partial<ProductPlanInput> = {}): ProductPlanInput {
  return {
    productId: "prod_1",
    handle: "h",
    existingMetadata: { source_url: "https://aveda/p/1", external_id: "111" },
    proposedCanonical: { ...baseProposed },
    identity: { source_url: "https://aveda/p/1", external_id: "111" },
    duplicate: { sourceUrl: false, externalId: false },
    parserErrors: [],
    missingSourceData: [],
    sourceEvidence: "test",
    ...over,
  }
}

describe("classifyIdentity", () => {
  const id = { source_url: "u", external_id: "e" }
  it("source_url + external_id eşleşirse full/high", () => {
    expect(classifyIdentity(id, id, { sourceUrl: false, externalId: false })).toEqual({
      match: "full",
      confidence: "high",
    })
  })
  it("yalnız source_url eşleşirse partial_source_url/low", () => {
    const r = classifyIdentity(
      { source_url: "u", external_id: "e1" },
      { source_url: "u", external_id: "e2" },
      { sourceUrl: false, externalId: false }
    )
    expect(r.match).toBe("partial_source_url")
    expect(r.confidence).toBe("low")
  })
  it("yalnız external_id eşleşirse partial_external_id/low", () => {
    const r = classifyIdentity(
      { source_url: "u1", external_id: "e" },
      { source_url: "u2", external_id: "e" },
      { sourceUrl: false, externalId: false }
    )
    expect(r.match).toBe("partial_external_id")
  })
  it("ikisi de farklı ürünü işaret ederse conflict", () => {
    const r = classifyIdentity(
      { source_url: "u1", external_id: "e1" },
      { source_url: "u2", external_id: "e2" },
      { sourceUrl: false, externalId: false }
    )
    expect(r.match).toBe("conflict")
  })
  it("duplicate identity ise duplicate", () => {
    const r = classifyIdentity(id, id, { sourceUrl: true, externalId: false })
    expect(r.match).toBe("duplicate")
  })
})

describe("buildProductPlan", () => {
  it("güvenli match + geçerli taxonomy + boş alanlar → added + ready_for_v2 + version 2", () => {
    const p = buildProductPlan(makeInput())
    expect(p.status).toBe("ready_for_v2")
    expect(p.metadata_version_after_proposed).toBe(2)
    expect(p.fields_added).toContain("category")
    expect(p.fields_added).toContain("hair_type")
    expect(p.approved_patch.metadata_version).toBe(2)
    expect(p.approved_patch.category).toBe("sac-bakim")
    expect(p.approved_patch.color_safe).toBeUndefined()
  })

  it("aynı canonical değer → unchanged", () => {
    const p = buildProductPlan(
      makeInput({
        existingMetadata: {
          source_url: "https://aveda/p/1",
          external_id: "111",
          category: "sac-bakim",
        },
      })
    )
    expect(p.fields_unchanged).toContain("category")
  })

  it("V2 ürün + farklı canonical category → gerçek conflict + needs_review", () => {
    const p = buildProductPlan(
      makeInput({
        existingMetadata: {
          source_url: "https://aveda/p/1",
          external_id: "111",
          metadata_version: 2,
          category: "FARKLI",
          category_path: "Aveda > x > y",
          category_external_id: "product-catalog:category:aveda:x:y",
        },
      })
    )
    expect(p.fields_conflicted).toContain("category")
    expect(p.status).toBe("needs_review")
    expect(p.metadata_version_after_proposed).toBeNull()
  })

  it("V1 legacy (sürüm yok/1, canonical kategori yok, mapping geçerli) + farklı category → normalized, conflict DEĞİL, V2 önerilebilir", () => {
    const p = buildProductPlan(
      makeInput({
        existingMetadata: {
          source_url: "https://aveda/p/1",
          external_id: "111",
          category: "sac-bakim-eski",
          sub_category: "sampuan-eski",
          // metadata_version yok, canonical category_path/external_id yok
        },
      })
    )
    expect(p.fields_conflicted).not.toContain("category")
    expect(p.fields_normalized).toContain("category")
    expect(p.status).toBe("ready_for_v2")
    expect(p.metadata_version_after_proposed).toBe(2)
  })

  it("boş kaynak mevcut dolu değeri silmez → preserved", () => {
    const p = buildProductPlan(
      makeInput({
        existingMetadata: {
          source_url: "https://aveda/p/1",
          external_id: "111",
          color_safe: true, // proposed.color_safe = null
        },
      })
    )
    expect(p.fields_preserved).toContain("color_safe")
  })

  it("legacy sub_category varsa subcategory eklenmesi normalized", () => {
    const p = buildProductPlan(
      makeInput({
        existingMetadata: {
          source_url: "https://aveda/p/1",
          external_id: "111",
          sub_category: "sampuan",
        },
      })
    )
    expect(p.fields_normalized).toContain("subcategory")
  })

  it("bilinmeyen metadata alanı korunur (diff'e girmez)", () => {
    const p = buildProductPlan(
      makeInput({
        existingMetadata: {
          source_url: "https://aveda/p/1",
          external_id: "111",
          custom_admin_note: "elle girildi",
        },
      })
    )
    expect(p.diffs.some((d) => d.field === "custom_admin_note")).toBe(false)
  })

  it("taxonomy çözülemezse hata + ready_for_v2 değil", () => {
    const p = buildProductPlan(
      makeInput({
        proposedCanonical: {
          ...baseProposed,
          category_external_id: null,
          category_path: null,
        },
      })
    )
    expect(p.taxonomy_validation_errors.length).toBeGreaterThan(0)
    expect(p.status).not.toBe("ready_for_v2")
    expect(p.metadata_version_after_proposed).toBeNull()
  })

  it("duplicate identity → rejected, version null", () => {
    const p = buildProductPlan(
      makeInput({ duplicate: { sourceUrl: true, externalId: false } })
    )
    expect(p.status).toBe("rejected")
    expect(p.metadata_version_after_proposed).toBeNull()
  })

  it("parser hatası varsa ready_for_v2 değil", () => {
    const p = buildProductPlan(makeInput({ parserErrors: ["x"] }))
    expect(p.status).toBe("needs_review")
  })

  it("fiyat/görsel/varyant patch'e girmez ve untouched işaretli", () => {
    const p = buildProductPlan(makeInput())
    expect(p.price_untouched).toBe(true)
    expect(p.images_untouched).toBe(true)
    expect(p.variants_untouched).toBe(true)
    const touched = p.diffs.map((d) => d.field)
    for (const banned of ["price", "thumbnail", "images", "variants", "title", "handle"]) {
      expect(touched).not.toContain(banned)
    }
  })
})
