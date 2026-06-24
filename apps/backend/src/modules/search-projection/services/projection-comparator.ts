import { SearchProjection } from "../search-projection.types"

export const PROJECTION_PERSISTED_FIELDS = [
  "product_id",
  "external_id",
  "handle",
  "title",
  "brand",
  "category_ids",
  "category_path",
  "subcategory",
  "collection",
  "hair_type",
  "concerns",
  "benefits",
  "size_ml",
  "vegan",
  "color_safe",
  "professional_only",
  "price",
  "currency",
  "in_stock",
  "thumbnail",
  "average_rating",
  "review_count",
  "weekly_sales_score",
  "monthly_sales_score",
  "all_time_sales_score",
  "favorite_score",
  "trending_score",
  "source_created_at",
  "source_updated_at",
  "metadata_version",
  "projection_schema_version",
] as const satisfies readonly (keyof SearchProjection)[]

export type ProjectionPersistedField =
  (typeof PROJECTION_PERSISTED_FIELDS)[number]

export type PersistedProjection = {
  id: string
  product_id: string
  created_at?: unknown
  updated_at?: unknown
  deleted_at?: unknown
  raw_price?: unknown
} & Partial<Record<ProjectionPersistedField, unknown>>

const ARRAY_FIELDS = new Set<ProjectionPersistedField>([
  "category_ids",
  "hair_type",
  "concerns",
  "benefits",
])

const DATE_FIELDS = new Set<ProjectionPersistedField>([
  "source_created_at",
  "source_updated_at",
])

const NUMBER_FIELDS = new Set<ProjectionPersistedField>([
  "size_ml",
  "price",
  "average_rating",
  "review_count",
  "weekly_sales_score",
  "monthly_sales_score",
  "all_time_sales_score",
  "favorite_score",
  "trending_score",
  "metadata_version",
  "projection_schema_version",
])

export function projectionsEqual(
  persisted: PersistedProjection,
  candidate: SearchProjection
): boolean {
  return PROJECTION_PERSISTED_FIELDS.every((field) =>
    valuesEqual(field, persisted[field], candidate[field])
  )
}

function valuesEqual(
  field: ProjectionPersistedField,
  persisted: unknown,
  candidate: unknown
): boolean {
  const left = persisted === undefined ? null : persisted
  const right = candidate === undefined ? null : candidate

  if (left === null || right === null) return left === right

  if (ARRAY_FIELDS.has(field)) {
    return arraysEqual(normalizeArray(left), normalizeArray(right))
  }

  if (DATE_FIELDS.has(field)) {
    return normalizeDate(left) === normalizeDate(right)
  }

  if (NUMBER_FIELDS.has(field)) {
    return normalizeNumber(left) === normalizeNumber(right)
  }

  return left === right
}

function normalizeArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  if (!value.every((item): item is string => typeof item === "string")) {
    return null
  }
  return [...value].sort()
}

function arraysEqual(left: string[] | null, right: string[] | null): boolean {
  if (left === null || right === null) return left === right
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function normalizeDate(value: unknown): number | null {
  if (!(value instanceof Date) && typeof value !== "string") return null
  const instant = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isNaN(instant) ? null : instant
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}
