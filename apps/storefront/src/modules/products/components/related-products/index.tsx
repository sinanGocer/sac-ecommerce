import { listProducts } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import { HttpTypes } from "@medusajs/types"
import Product from "../product-preview"

type RelatedProductsProps = {
  product: HttpTypes.StoreProduct
  countryCode: string
}

export default async function RelatedProducts({
  product,
  countryCode,
}: RelatedProductsProps) {
  const region = await getRegion(countryCode)

  if (!region) {
    return null
  }

  // Ürünün kategorilerini çöz (aynı kategoriden benzer ürünler için)
  const categoryIds = await listProducts({
    countryCode,
    queryParams: {
      id: [product.id],
      fields: "categories.id",
    } as HttpTypes.StoreProductListParams,
  }).then(({ response }) =>
    (response.products[0]?.categories ?? []).map((c) => c.id).filter(Boolean)
  )

  const queryParams: HttpTypes.StoreProductListParams = {
    limit: 4,
    is_giftcard: false,
  }
  if (region?.id) {
    queryParams.region_id = region.id
  }
  if (categoryIds.length) {
    queryParams.category_id = categoryIds as string[]
  }

  const products = await listProducts({
    queryParams,
    countryCode,
  }).then(({ response }) => {
    return response.products.filter(
      (responseProduct) => responseProduct.id !== product.id
    )
  })

  if (!products.length) {
    return null
  }

  return (
    <div className="product-page-constraint">
      <div className="mb-12 flex flex-col items-center text-center">
        <span className="text-[11px] uppercase tracking-[0.3em] text-neutral-400">
          Tamamlayıcı Ürünler
        </span>
        <p className="mt-3 font-serif text-2xl text-ui-fg-base small:text-3xl">
          Benzer Ürünler
        </p>
      </div>

      <ul className="grid grid-cols-2 gap-4 small:grid-cols-3 small:gap-6 medium:grid-cols-4">
        {products.map((product) => (
          <li key={product.id} className="h-full">
            <Product region={region} product={product} isFeatured />
          </li>
        ))}
      </ul>
    </div>
  )
}
