import { HttpTypes } from "@medusajs/types"

import { getProductPrice } from "./get-product-price"
import { normalizeProductDescription } from "./product-description"
import { resolveProductImageUrl } from "./product-image"

type ProductVariantWithInventory = HttpTypes.StoreProductVariant & {
  inventory_quantity?: number | null
}

export function buildProductSeoDescription(product: HttpTypes.StoreProduct) {
  const description = normalizeProductDescription(product.description)
  const text = [product.title, description].filter(Boolean).join(" - ")

  return truncate(text || product.title || "Profesyonel saç bakım ürünü", 160)
}

export function buildProductCanonicalUrl({
  baseUrl,
  countryCode,
  handle,
}: {
  baseUrl: string
  countryCode: string
  handle: string
}) {
  return new URL(
    `/${encodeURIComponent(countryCode)}/products/${encodeURIComponent(handle)}`,
    baseUrl
  ).toString()
}

export function buildProductImageUrl({
  baseUrl,
  product,
}: {
  baseUrl: string
  product: HttpTypes.StoreProduct
}) {
  const image = resolveProductImageUrl({
    thumbnail: product.thumbnail,
    images: product.images,
  })

  if (!image) return null

  try {
    return new URL(image, baseUrl).toString()
  } catch {
    return null
  }
}

export function buildProductJsonLd({
  baseUrl,
  countryCode,
  product,
}: {
  baseUrl: string
  countryCode: string
  product: HttpTypes.StoreProduct
}) {
  const price = getProductPrice({ product }).cheapestPrice
  const canonicalUrl = buildProductCanonicalUrl({
    baseUrl,
    countryCode,
    handle: product.handle,
  })
  const imageUrl = buildProductImageUrl({ baseUrl, product })

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: buildProductSeoDescription(product),
    sku: product.variants?.[0]?.sku ?? product.id,
    url: canonicalUrl,
    brand: {
      "@type": "Brand",
      name:
        typeof product.metadata?.brand === "string"
          ? product.metadata.brand
          : "Sinan Koçer Hair Store",
    },
    offers: {
      "@type": "Offer",
      url: canonicalUrl,
      priceCurrency: (price?.currency_code ?? "try").toUpperCase(),
      price: price?.calculated_price_number ?? undefined,
      availability: isProductAvailable(product)
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
    },
  }

  if (imageUrl) {
    data.image = [imageUrl]
  }

  return data
}

export function isProductAvailable(product: HttpTypes.StoreProduct) {
  return Boolean(
    product.variants?.some((variant) => {
      const v = variant as ProductVariantWithInventory
      if (v.manage_inventory === false) return true
      return typeof v.inventory_quantity === "number" && v.inventory_quantity > 0
    })
  )
}

function truncate(value: string, max: number) {
  const trimmed = value.replace(/\s+/g, " ").trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1).trim()}…`
}
