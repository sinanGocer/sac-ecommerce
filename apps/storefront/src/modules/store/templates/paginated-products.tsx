import { listProductsWithSort } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import ProductPreview from "@modules/products/components/product-preview"
import { Pagination } from "@modules/store/components/pagination"
import { SortOptions } from "@modules/store/components/refinement-list/sort-products"
import { DEFAULT_CATALOG_PAGE_SIZE } from "@lib/util/catalog-pagination"

const PRODUCT_LIMIT = DEFAULT_CATALOG_PAGE_SIZE

type PaginatedProductsParams = {
  limit: number
  collection_id?: string[]
  category_id?: string[]
  id?: string[]
  order?: string
}

export default async function PaginatedProducts({
  sortBy,
  page,
  collectionId,
  categoryId,
  productsIds,
  countryCode,
}: {
  sortBy?: SortOptions
  page: number
  collectionId?: string
  categoryId?: string
  productsIds?: string[]
  countryCode: string
}) {
  const queryParams: PaginatedProductsParams = {
    limit: PRODUCT_LIMIT,
  }

  if (collectionId) {
    queryParams["collection_id"] = [collectionId]
  }

  if (categoryId) {
    queryParams["category_id"] = [categoryId]
  }

  if (productsIds) {
    queryParams["id"] = productsIds
  }

  if (sortBy === "created_at") {
    // Medusa bulk creates share the same created_at timestamp. ULID ids keep
    // newest-first ordering deterministic across offset pages.
    queryParams["order"] = "-id"
  }

  const region = await getRegion(countryCode)

  if (!region) {
    return null
  }

  const {
    response: { products, count },
    currentPage,
  } = await listProductsWithSort({
    page,
    queryParams,
    sortBy,
    countryCode,
  })

  const totalPages = Math.ceil(count / PRODUCT_LIMIT)

  return (
    <>
      <ul
        className="grid w-full grid-cols-2 gap-4 small:grid-cols-3 small:gap-6 medium:grid-cols-4"
        data-testid="products-list"
      >
        {products.map((p, index) => {
          return (
            <li key={p.id} className="h-full">
              <ProductPreview
                product={p}
                region={region}
                isFeatured
                priority={index < 4}
              />
            </li>
          )
        })}
      </ul>
      {totalPages > 1 && (
        <Pagination
          data-testid="product-pagination"
          page={currentPage}
          totalPages={totalPages}
        />
      )}
    </>
  )
}
