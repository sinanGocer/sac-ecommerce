import { HttpTypes } from "@medusajs/types"
import { Heading, Text } from "@modules/common/components/ui"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { normalizeProductDescription } from "@lib/util/product-description"

type ProductInfoProps = {
  product: HttpTypes.StoreProduct
}

const ProductInfo = ({ product }: ProductInfoProps) => {
  const description = normalizeProductDescription(product.description)
  const sizeMl =
    typeof product.metadata?.size_ml === "number"
      ? product.metadata.size_ml
      : null
  const isTravel = product.metadata?.size_type === "travel"

  return (
    <div id="product-info">
      <div className="flex flex-col gap-y-4 lg:max-w-[500px] mx-auto">
        {product.collection && (
          <LocalizedClientLink
            href={`/collections/${product.collection.handle}`}
            className="text-medium text-ui-fg-muted hover:text-ui-fg-subtle"
          >
            {product.collection.title}
          </LocalizedClientLink>
        )}
        <Heading
          level="h1"
          className="text-3xl leading-10 text-ui-fg-base"
          data-testid="product-title"
        >
          {product.title}
        </Heading>

        {(sizeMl || isTravel) && (
          <div className="flex flex-wrap gap-2">
            {sizeMl && (
              <span className="bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700">
                {sizeMl} ml
              </span>
            )}
            {isTravel && (
              <span className="bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900">
                Seyahat Boy
              </span>
            )}
          </div>
        )}

        <Text
          className="text-medium text-ui-fg-subtle whitespace-pre-line"
          data-testid="product-description"
        >
          {description}
        </Text>
      </div>
    </div>
  )
}

export default ProductInfo
