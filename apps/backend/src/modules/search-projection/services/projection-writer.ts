import { SearchProjection } from "../search-projection.types"
import SearchProjectionService from "../service"

/**
 * Projection yazıcı — SearchProjectionService üzerinden idempotent upsert.
 *
 * - RAW SQL YOK; tüm yazım MedusaService otomatik CRUD'u ile yapılır.
 * - Idempotent: product_id varsa UPDATE, yoksa CREATE.
 * - Batch: her partide TEK liste sorgusu ile mevcutlar bulunur (N+1 yok).
 * - created_at/updated_at/deleted_at DB-managed → yazılmaz.
 */
export interface UpsertResult {
  created: number
  updated: number
}

// Yazılabilir kısım: satır yaşam döngüsü alanları hariç.
// source_* alanları DB'de dateTime → Date'e çevrilir (builder ISO string üretir).
type WritableProjection = Omit<
  SearchProjection,
  "created_at" | "updated_at" | "source_created_at" | "source_updated_at"
> & {
  source_created_at: Date | null
  source_updated_at: Date | null
}

export class ProjectionWriter {
  constructor(private readonly service: SearchProjectionService) {}

  async upsertBatch(projections: SearchProjection[]): Promise<UpsertResult> {
    if (projections.length === 0) {
      return { created: 0, updated: 0 }
    }

    const productIds = projections.map((p) => p.product_id)

    // Mevcut kayıtları TEK sorguda çek (N+1 yok)
    const existing = await this.service.listProductSearchProjections(
      { product_id: productIds },
      { select: ["id", "product_id"], take: productIds.length }
    )

    const idByProductId = new Map<string, string>()
    for (const row of existing) {
      idByProductId.set(row.product_id, row.id)
    }

    const toCreate: WritableProjection[] = []
    const toUpdate: Array<WritableProjection & { id: string }> = []

    for (const projection of projections) {
      const data = this.toWritable(projection)
      const existingId = idByProductId.get(projection.product_id)
      if (existingId) {
        toUpdate.push({ id: existingId, ...data })
      } else {
        toCreate.push(data)
      }
    }

    if (toCreate.length > 0) {
      await this.service.createProductSearchProjections(toCreate)
    }
    if (toUpdate.length > 0) {
      await this.service.updateProductSearchProjections(toUpdate)
    }

    return { created: toCreate.length, updated: toUpdate.length }
  }

  private toWritable(projection: SearchProjection): WritableProjection {
    // created_at/updated_at DB tarafından yönetilir; yazıma dahil edilmez.
    // source_* alanları ISO string → Date'e çevrilir (model dateTime bekler).
    const {
      created_at,
      updated_at,
      source_created_at,
      source_updated_at,
      ...rest
    } = projection
    void created_at
    void updated_at
    return {
      ...rest,
      source_created_at: source_created_at ? new Date(source_created_at) : null,
      source_updated_at: source_updated_at ? new Date(source_updated_at) : null,
    }
  }
}
