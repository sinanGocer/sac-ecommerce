import { SearchProjection } from "../search-projection.types"
import {
  PersistedProjection,
  projectionsEqual,
} from "../services/projection-comparator"
import { ProjectionWriter } from "../services/projection-writer"

const projection: SearchProjection = {
  product_id: "prod_1",
  external_id: "external_1",
  handle: "product-1",
  title: "Product 1",
  brand: "Aveda",
  category_ids: ["cat_2", "cat_1"],
  category_path: "Aveda > Şampuan",
  subcategory: "Color Care",
  collection: null,
  hair_type: ["dry", "color-treated"],
  concerns: ["dryness"],
  benefits: ["shine"],
  size_ml: 200,
  vegan: false,
  color_safe: true,
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

function persisted(
  overrides: Partial<PersistedProjection> = {}
): PersistedProjection {
  return {
    id: "psp_1",
    ...projection,
    source_created_at: new Date(projection.source_created_at!),
    source_updated_at: new Date(projection.source_updated_at!),
    price: "500",
    ...overrides,
  }
}

function serviceWith(rows: PersistedProjection[]) {
  return {
    listProductSearchProjections: jest.fn().mockResolvedValue(rows),
    createProductSearchProjections: jest.fn().mockResolvedValue([]),
    updateProductSearchProjections: jest.fn().mockResolvedValue([]),
  }
}

describe("projection semantic comparison", () => {
  it("aynı projection'ı eşit kabul eder", () => {
    expect(projectionsEqual(persisted(), projection)).toBe(true)
  })

  it("tek scalar farkını algılar", () => {
    expect(projectionsEqual(persisted({ title: "Changed" }), projection)).toBe(
      false
    )
  })

  it("array sırası semantik fark üretmez, içerik farkı üretir", () => {
    expect(
      projectionsEqual(
        persisted({ category_ids: ["cat_1", "cat_2"] }),
        projection
      )
    ).toBe(true)
    expect(
      projectionsEqual(persisted({ category_ids: ["cat_1"] }), projection)
    ).toBe(false)
  })

  it("aynı date instant'ını eşit, farklı instant'ı farklı kabul eder", () => {
    expect(
      projectionsEqual(
        persisted({ source_updated_at: "2026-06-22T14:00:00.000+03:00" }),
        projection
      )
    ).toBe(true)
    expect(
      projectionsEqual(
        persisted({ source_updated_at: "2026-06-22T11:00:01.000Z" }),
        projection
      )
    ).toBe(false)
  })

  it("framework alanlarını karşılaştırmaya dahil etmez", () => {
    expect(
      projectionsEqual(
        {
          ...persisted(),
          id: "psp_other",
          created_at: "2020-01-01",
          updated_at: "2020-01-02",
        },
        projection
      )
    ).toBe(true)
  })

  it("false ve 0 değerlerini eksik değerle eşit saymaz", () => {
    expect(projectionsEqual(persisted({ vegan: undefined }), projection)).toBe(
      false
    )
    expect(
      projectionsEqual(persisted({ review_count: undefined }), projection)
    ).toBe(false)
  })
})

describe("ProjectionWriter", () => {
  it("tamamen aynı satırda update çağırmaz", async () => {
    const service = serviceWith([persisted()])
    const result = await new ProjectionWriter(service).upsertBatch([
      projection,
    ])

    expect(result).toEqual({
      created: 0,
      updated: 0,
      unchanged: 1,
      db_writes: 0,
    })
    expect(service.updateProductSearchProjections).not.toHaveBeenCalled()
  })

  it("gerçek farkta yalnız değişen satırı update eder", async () => {
    const service = serviceWith([persisted({ title: "Old title" })])
    const result = await new ProjectionWriter(service).upsertBatch([
      projection,
    ])

    expect(result).toEqual({
      created: 0,
      updated: 1,
      unchanged: 0,
      db_writes: 1,
    })
    expect(service.updateProductSearchProjections).toHaveBeenCalledTimes(1)
  })

  it("mevcut olmayan projection'ı create listesine ekler", async () => {
    const service = serviceWith([])
    const result = await new ProjectionWriter(service).upsertBatch([
      projection,
    ])

    expect(result.created).toBe(1)
    expect(result.db_writes).toBe(1)
    expect(service.createProductSearchProjections).toHaveBeenCalledTimes(1)
  })

  it("karışık batch sayaçlarını doğru üretir", async () => {
    const update = { ...projection, product_id: "prod_2", title: "New title" }
    const create = { ...projection, product_id: "prod_3" }
    const service = serviceWith([
      persisted(),
      persisted({ id: "psp_2", product_id: "prod_2", title: "Old title" }),
    ])

    const result = await new ProjectionWriter(service).upsertBatch([
      projection,
      update,
      create,
    ])

    expect(result).toEqual({
      created: 1,
      updated: 1,
      unchanged: 1,
      db_writes: 2,
    })
  })

  it("tüm batch unchanged ise hiçbir write servisini çağırmaz", async () => {
    const second = { ...projection, product_id: "prod_2" }
    const service = serviceWith([
      persisted(),
      persisted({ id: "psp_2", product_id: "prod_2" }),
    ])

    const result = await new ProjectionWriter(service).upsertBatch([
      projection,
      second,
    ])

    expect(result.unchanged).toBe(2)
    expect(result.db_writes).toBe(0)
    expect(service.createProductSearchProjections).not.toHaveBeenCalled()
    expect(service.updateProductSearchProjections).not.toHaveBeenCalled()
  })

  it("dry-run sınıflandırır fakat DB write çağrısı yapmaz", async () => {
    const update = { ...projection, product_id: "prod_2", title: "New title" }
    const create = { ...projection, product_id: "prod_3" }
    const service = serviceWith([
      persisted(),
      persisted({ id: "psp_2", product_id: "prod_2", title: "Old title" }),
    ])

    const result = await new ProjectionWriter(service).upsertBatch(
      [projection, update, create],
      { dryRun: true }
    )

    expect(result).toEqual({
      created: 1,
      updated: 1,
      unchanged: 1,
      db_writes: 0,
    })
    expect(service.createProductSearchProjections).not.toHaveBeenCalled()
    expect(service.updateProductSearchProjections).not.toHaveBeenCalled()
  })
})
