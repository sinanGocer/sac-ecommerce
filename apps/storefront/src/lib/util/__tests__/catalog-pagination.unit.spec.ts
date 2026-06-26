import {
  catalogOffset,
  catalogTotalPages,
  clampCatalogPage,
  normalizeCatalogPage,
} from "../catalog-pagination"

const assertEqual = (actual: unknown, expected: unknown, message: string) => {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`)
  }
}

export const runCatalogPaginationAssertions = () => {
  assertEqual(catalogTotalPages(45, 10), 5, "45 products create five pages")
  assertEqual(catalogOffset(1, 10), 0, "page one starts at offset zero")
  assertEqual(catalogOffset(2, 10), 10, "page two starts at offset ten")
  assertEqual(catalogOffset(5, 10), 40, "page five starts at offset forty")
  assertEqual(normalizeCatalogPage("invalid"), 1, "invalid page uses page one")
  assertEqual(normalizeCatalogPage("0"), 1, "page zero uses page one")
  assertEqual(clampCatalogPage(9, 5), 5, "overflow page uses last page")
  assertEqual(45 - catalogOffset(5, 10), 5, "last page contains five products")
  assertEqual(catalogTotalPages(20, 10), 2, "page count follows product count")
  assertEqual(
    catalogOffset(1, 10) === catalogOffset(2, 10),
    false,
    "different pages use different offsets"
  )
}
