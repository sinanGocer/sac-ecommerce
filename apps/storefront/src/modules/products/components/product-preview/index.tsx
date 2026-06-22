import { Text } from "@modules/common/components/ui"
import { getProductPrice } from "@lib/util/get-product-price"
import { HttpTypes } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import Thumbnail from "../thumbnail"
import PreviewPrice from "./price"
import AddToCartCard from "./add-to-cart-card"

export default async function ProductPreview({
  product,
  isFeatured,
  region: _region,
}: {
  product: HttpTypes.StoreProduct
  isFeatured?: boolean
  region: HttpTypes.StoreRegion
}) {
  const { cheapestPrice } = getProductPrice({ product })

  // Badge sistemi: admin'de product.metadata.badge ile ayarlanabilir.
  // Varsayılan: "Profesyonel Seri".
  const badge =
    (product.metadata?.badge as string | undefined) || "Profesyonel Seri"
  const isTop = badge === "En Çok Tercih Edilen"

  return (
    <div
      data-testid="product-wrapper"
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white transition-all duration-300 hover:-translate-y-1 hover:border-neutral-300 hover:shadow-xl"
    >
      <LocalizedClientLink
        href={`/products/${product.handle}`}
        className="group block"
      >
        <div className="relative overflow-hidden bg-neutral-50">
          {badge && (
            <span
              className={`absolute left-3 top-3 z-10 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                isTop
                  ? "bg-amber-100 text-amber-900"
                  : "bg-neutral-900/85 text-white"
              }`}
            >
              {badge}
            </span>
          )}
          <Thumbnail
            thumbnail={product.thumbnail}
            images={product.images}
            size="full"
            isFeatured={isFeatured}
            className="!rounded-none !bg-transparent !p-0 !shadow-none transition-transform duration-500 group-hover:scale-105"
          />
        </div>
        <div className="flex flex-col gap-1 px-4 pt-4">
          <Text
            className="line-clamp-2 text-sm font-medium leading-snug text-neutral-900 small:text-base"
            data-testid="product-title"
          >
            {product.title}
          </Text>
          <div className="mt-1 flex items-center gap-x-2">
            {cheapestPrice ? (
              <PreviewPrice price={cheapestPrice} />
            ) : (
              <span className="text-sm text-neutral-400">Fiyat için tıklayın</span>
            )}
          </div>
        </div>
      </LocalizedClientLink>

      <div className="mt-auto p-4 pt-3">
        <AddToCartCard product={product} />
      </div>
    </div>
  )
}
