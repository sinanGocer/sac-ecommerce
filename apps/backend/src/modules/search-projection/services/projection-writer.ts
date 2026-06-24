import { SearchProjection } from "../search-projection.types"
import {
  PersistedProjection,
  PROJECTION_PERSISTED_FIELDS,
  projectionsEqual,
} from "./projection-comparator"

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
  unchanged: number
  db_writes: number
}

export interface UpsertOptions {
  dryRun?: boolean
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

export interface ProjectionWriterService {
  listProductSearchProjections(
    filters: { product_id: string[] },
    config: { select: string[]; take: number }
  ): Promise<PersistedProjection[]>
  createProductSearchProjections(
    data: WritableProjection[]
  ): Promise<unknown>
  updateProductSearchProjections(
    data: Array<WritableProjection & { id: string }>
  ): Promise<unknown>
}

export class ProjectionWriter {
  constructor(private readonly service: ProjectionWriterService) {}

  async upsertBatch(
    projections: SearchProjection[],
    options: UpsertOptions = {}
  ): Promise<UpsertResult> {
    if (projections.length === 0) {
      return { created: 0, updated: 0, unchanged: 0, db_writes: 0 }
    }

    const productIds = projections.map((p) => p.product_id)

    // Mevcut kayıtları TEK sorguda çek (N+1 yok)
    const existing = await this.service.listProductSearchProjections(
      { product_id: productIds },
      {
        select: ["id", ...PROJECTION_PERSISTED_FIELDS],
        take: productIds.length,
      }
    )

    const existingByProductId = new Map<string, PersistedProjection>()
    for (const row of existing) {
      existingByProductId.set(row.product_id, row)
    }

    const toCreate: WritableProjection[] = []
    const toUpdate: Array<WritableProjection & { id: string }> = []
    let unchanged = 0

    for (const projection of projections) {
      const data = this.toWritable(projection)
      const persisted = existingByProductId.get(projection.product_id)
      if (!persisted) {
        toCreate.push(data)
      } else if (projectionsEqual(persisted, projection)) {
        unchanged++
      } else {
        toUpdate.push({ id: persisted.id, ...data })
      }
    }

    if (!options.dryRun && toCreate.length > 0) {
      await this.service.createProductSearchProjections(toCreate)
    }
    if (!options.dryRun && toUpdate.length > 0) {
      await this.service.updateProductSearchProjections(toUpdate)
    }

    return {
      created: toCreate.length,
      updated: toUpdate.length,
      unchanged,
      db_writes: options.dryRun ? 0 : toCreate.length + toUpdate.length,
    }
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
