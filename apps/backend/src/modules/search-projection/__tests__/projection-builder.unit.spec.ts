import { buildSearchProjection } from "../projection-builder"
import {
  BuilderProductInput,
  HEAVY_FIELDS_EXCLUDED,
} from "../search-projection.types"

const baseInput: BuilderProductInput = {
  id: "prod_1",
  handle: "shampure-besleyici-sampuan",
  title: "Shampure Besleyici Şampuan",
  thumbnail: "https://cdn/x.jpg",
  created_at: "2026-06-22T10:00:00.000Z",
  updated_at: "2026-06-22T11:00:00.000Z",
  category_ids: ["cat_1", "cat_2"],
  collection_title: null,
  metadata: {
    external_id: "62089",
    brand: "Aveda",
    category_path: "aveda/sac-bakim/sampuan",
    subcategory: "sampuan",
    hair_type: ["kuru", "yipranmis", 5],
    concerns: ["nem"],
    benefits: ["besleyici"],
    size_ml: 250,
    vegan: true,
    color_safe: "false",
    metadata_version: 2,
  },
  variants: [
    {
      prices: [
        { amount: 520, currency_code: "try" },
        { amount: 18, currency_code: "usd" },
      ],
      inventory_quantity: null,
      manage_inventory: false,
    },
    {
      prices: [{ amount: 480, currency_code: "TRY" }],
      inventory_quantity: 0,
      manage_inventory: true,
    },
  ],
}

describe("buildSearchProjection", () => {
  it("metadata alanlarını doğru eşler", () => {
    const p = buildSearchProjection(baseInput)
    expect(p.product_id).toBe("prod_1")
    expect(p.external_id).toBe("62089")
    expect(p.brand).toBe("Aveda")
    expect(p.category_ids).toEqual(["cat_1", "cat_2"])
    expect(p.category_path).toBe("aveda/sac-bakim/sampuan")
    expect(p.subcategory).toBe("sampuan")
    expect(p.size_ml).toBe(250)
    expect(p.vegan).toBe(true)
    expect(p.color_safe).toBe(false) // "false" string -> boolean
    expect(p.metadata_version).toBe(2)
  })

  it("string olmayan dizi elemanlarını ayıklar", () => {
    const p = buildSearchProjection(baseInput)
    expect(p.hair_type).toEqual(["kuru", "yipranmis"])
    expect(p.concerns).toEqual(["nem"])
    expect(p.benefits).toEqual(["besleyici"])
  })

  it("hedef para biriminde en düşük fiyatı seçer (case-insensitive)", () => {
    const p = buildSearchProjection(baseInput, { currency: "try" })
    expect(p.price).toBe(480)
    expect(p.currency).toBe("try")
  })

  it("manage_inventory=false varyant varsa stokta sayar", () => {
    const p = buildSearchProjection(baseInput)
    expect(p.in_stock).toBe(true)
  })

  it("yönetilen stok 0 ise ve başka stok yoksa stokta değildir", () => {
    const input: BuilderProductInput = {
      ...baseInput,
      variants: [
        {
          prices: [{ amount: 100, currency_code: "try" }],
          inventory_quantity: 0,
          manage_inventory: true,
        },
      ],
    }
    const p = buildSearchProjection(input)
    expect(p.in_stock).toBe(false)
  })

  it("kaynağı olmayan skor alanları uydurulmaz (açık varsayılan)", () => {
    const p = buildSearchProjection(baseInput)
    expect(p.average_rating).toBeNull()
    expect(p.review_count).toBe(0)
    expect(p.weekly_sales_score).toBe(0)
    expect(p.monthly_sales_score).toBe(0)
    expect(p.all_time_sales_score).toBe(0)
    expect(p.favorite_score).toBe(0)
    expect(p.trending_score).toBe(0)
  })

  it("professional_only kaynağı yoksa false döner", () => {
    const p = buildSearchProjection(baseInput)
    expect(p.professional_only).toBe(false)
  })

  it("collection: metadata yoksa collection_title'a düşer", () => {
    const input: BuilderProductInput = {
      ...baseInput,
      collection_title: "Nutriplenish",
      metadata: { ...baseInput.metadata, collection: undefined },
    }
    const p = buildSearchProjection(input)
    expect(p.collection).toBe("Nutriplenish")
  })

  it("ağır alanları projection'a almaz", () => {
    const p = buildSearchProjection(baseInput) as unknown as Record<
      string,
      unknown
    >
    for (const heavy of HEAVY_FIELDS_EXCLUDED) {
      expect(p[heavy]).toBeUndefined()
    }
  })

  it("ürün tarihlerini source_* alanlarına ISO olarak yazar; created_at/updated_at'ı EZMEZ", () => {
    const p = buildSearchProjection(baseInput)
    // Projection satır yaşam döngüsü (DB-managed) → builder null bırakır
    expect(p.created_at).toBeNull()
    expect(p.updated_at).toBeNull()
    // Ürünün gerçek tarihleri ayrı alanlarda
    expect(p.source_created_at).toBe("2026-06-22T10:00:00.000Z")
    expect(p.source_updated_at).toBe("2026-06-22T11:00:00.000Z")
  })

  it("eksik metadata'da güvenli varsayılanlar üretir", () => {
    const input: BuilderProductInput = {
      id: "prod_2",
      handle: null,
      title: null,
      thumbnail: null,
      created_at: null,
      updated_at: null,
      category_ids: [],
      collection_title: null,
      metadata: null,
      variants: [],
    }
    const p = buildSearchProjection(input)
    expect(p.brand).toBeNull()
    expect(p.hair_type).toEqual([])
    expect(p.price).toBeNull()
    expect(p.in_stock).toBe(false)
    expect(p.source_created_at).toBeNull()
    expect(p.source_updated_at).toBeNull()
    expect(p.metadata_version).toBe(1)
    expect(p.projection_schema_version).toBe(1)
  })
})
