"use server"

import { sdk } from "@lib/config"
import { sortProducts } from "@lib/util/sort-products"
import { HttpTypes } from "@medusajs/types"
import { SortOptions } from "@modules/store/components/refinement-list/sort-products"
import { getAuthHeaders, getCacheOptions } from "./cookies"
import { getRegion, retrieveRegion } from "./regions"
import {
  catalogTotalPages,
  clampCatalogPage,
  normalizeCatalogPage,
} from "@lib/util/catalog-pagination"

const cacheValue = (value?: string | string[]): string =>
  Array.isArray(value) ? value.join(",") : value ?? ""

export const listProducts = async ({
  pageParam = 1,
  queryParams,
  countryCode,
  regionId,
}: {
  pageParam?: number
  queryParams?: HttpTypes.FindParams & HttpTypes.StoreProductListParams
  countryCode?: string
  regionId?: string
}): Promise<{
  response: { products: HttpTypes.StoreProduct[]; count: number }
  nextPage: number | null
  queryParams?: HttpTypes.FindParams & HttpTypes.StoreProductListParams
}> => {
  if (!countryCode && !regionId) {
    throw new Error("Country code or region ID is required")
  }

  const limit = queryParams?.limit || 12
  const normalizedPage = normalizeCatalogPage(pageParam)
  const offset = (normalizedPage - 1) * limit

  let region: HttpTypes.StoreRegion | undefined | null

  if (countryCode) {
    region = await getRegion(countryCode)
  } else {
    region = await retrieveRegion(regionId!)
  }

  if (!region) {
    return {
      response: { products: [], count: 0 },
      nextPage: null,
    }
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  const cacheScope = [
    "products",
    region.id,
    String(limit),
    String(offset),
    queryParams?.order ?? "default",
    cacheValue(queryParams?.category_id) || "all-categories",
    cacheValue(queryParams?.collection_id) || "all-collections",
    cacheValue(queryParams?.id) || "all-products",
  ].join("-")
  const next = { ...(await getCacheOptions(cacheScope)) }
  const fields =
    queryParams?.fields ??
    "*variants.calculated_price,+variants.inventory_quantity,*variants.images,+metadata,+tags,"
  const filters = { ...queryParams }
  delete filters.fields
  delete filters.limit
  delete filters.offset

  return sdk.client
    .fetch<{ products: HttpTypes.StoreProduct[]; count: number }>(
      `/store/products`,
      {
        method: "GET",
        query: {
          ...filters,
          limit,
          offset,
          region_id: region?.id,
          fields,
        },
        headers,
        next,
        cache: "force-cache",
      }
    )
    .then(({ products, count }) => {
      const nextPage =
        count > offset + limit ? normalizedPage + 1 : null

      return {
        response: {
          products,
          count,
        },
        nextPage: nextPage,
        queryParams,
      }
    })
}

/**
 * Price sorting still needs the bounded catalog set because Store API does not
 * sort calculated prices. Other sorts use real Store API limit/offset paging.
 */
export const listProductsWithSort = async ({
  page = 1,
  queryParams,
  sortBy = "created_at",
  countryCode,
}: {
  page?: number
  queryParams?: HttpTypes.FindParams & HttpTypes.StoreProductParams
  sortBy?: SortOptions
  countryCode: string
}): Promise<{
  response: { products: HttpTypes.StoreProduct[]; count: number }
  nextPage: number | null
  currentPage: number
  queryParams?: HttpTypes.FindParams & HttpTypes.StoreProductParams
}> => {
  const limit = queryParams?.limit || 12
  const normalizedPage = normalizeCatalogPage(page)

  if (["price_asc", "price_desc"].includes(sortBy)) {
    const {
      response: { products, count },
    } = await listProducts({
      pageParam: 1,
      queryParams: { ...queryParams, limit: 100 },
      countryCode,
    })

    const sortedProducts = sortProducts(products, sortBy)
    const totalPages = catalogTotalPages(count, limit)
    const currentPage = clampCatalogPage(normalizedPage, totalPages)
    const offset = (currentPage - 1) * limit

    return {
      response: {
        products: sortedProducts.slice(offset, offset + limit),
        count,
      },
      nextPage: currentPage < totalPages ? currentPage + 1 : null,
      currentPage,
      queryParams,
    }
  }

  let result = await listProducts({
    pageParam: normalizedPage,
    queryParams: { ...queryParams, limit },
    countryCode,
  })
  const totalPages = catalogTotalPages(result.response.count, limit)
  const currentPage = clampCatalogPage(normalizedPage, totalPages)

  if (currentPage !== normalizedPage) {
    result = await listProducts({
      pageParam: currentPage,
      queryParams: { ...queryParams, limit },
      countryCode,
    })
  }

  return {
    ...result,
    currentPage,
    queryParams,
  }
}
