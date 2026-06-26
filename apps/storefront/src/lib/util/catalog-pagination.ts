export const DEFAULT_CATALOG_PAGE_SIZE = 10

export const normalizeCatalogPage = (value: unknown): number => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
      ? Number(value)
      : NaN

  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1
}

export const catalogOffset = (
  page: unknown,
  limit = DEFAULT_CATALOG_PAGE_SIZE
): number => (normalizeCatalogPage(page) - 1) * limit

export const catalogTotalPages = (
  count: number,
  limit = DEFAULT_CATALOG_PAGE_SIZE
): number => (count > 0 ? Math.ceil(count / limit) : 0)

export const clampCatalogPage = (
  page: unknown,
  totalPages: number
): number => {
  const normalized = normalizeCatalogPage(page)

  return totalPages > 0 ? Math.min(normalized, totalPages) : 1
}
