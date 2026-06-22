import { listProducts } from "@lib/data/products"
import { HttpTypes } from "@medusajs/types"
import { Text } from "@modules/common/components/ui"

import InteractiveLink from "@modules/common/components/interactive-link"
import ProductPreview from "@modules/products/components/product-preview"

export default async function ProductRail({
  category,
  region,
}: {
  category: HttpTypes.StoreProductCategory
  region: HttpTypes.StoreRegion
}) {
  const {
    response: { products: pricedProducts },
  } = await listProducts({
    regionId: region.id,
    queryParams: {
      category_id: category.id,
      limit: 4,
      fields: "*variants.calculated_price,+metadata",
    },
  })

  if (!pricedProducts || pricedProducts.length === 0) {
    return null
  }

  return (
    <div className="content-container py-10 small:py-16">
      <div className="mb-8 flex items-end justify-between border-b border-ui-border-base pb-4">
        <Text className="font-serif text-2xl text-ui-fg-base small:text-3xl">
          {category.name}
        </Text>
        <InteractiveLink href={`/categories/${category.handle}`}>
          Tümünü Gör
        </InteractiveLink>
      </div>
      <ul className="grid grid-cols-2 gap-4 small:grid-cols-4 small:gap-6">
        {pricedProducts.map((product) => (
          <li key={product.id} className="h-full">
            <ProductPreview product={product} region={region} isFeatured />
          </li>
        ))}
      </ul>
    </div>
  )
}
