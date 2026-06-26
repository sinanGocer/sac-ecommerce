"use client"

import Image from "next/image"
import { useEffect, useMemo, useState } from "react"

import { resolveProductImageUrl } from "@lib/util/product-image"
import PlaceholderImage from "@modules/common/icons/placeholder-image"

type ProductImageProps = {
  thumbnail?: string | null
  images?: { url?: string | null }[] | null
  alt: string
  className?: string
  sizes?: string
  priority?: boolean
}

const ProductImage = ({
  thumbnail,
  images,
  alt,
  className,
  sizes,
  priority = false,
}: ProductImageProps) => {
  const resolvedUrl = useMemo(
    () => resolveProductImageUrl({ thumbnail, images }),
    [thumbnail, images]
  )
  const [imageUrl, setImageUrl] = useState(resolvedUrl)

  useEffect(() => {
    setImageUrl(resolvedUrl)
  }, [resolvedUrl])

  if (!imageUrl) {
    return (
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-100 px-4 text-center text-neutral-400"
        role="img"
        aria-label={`${alt} yakında`}
        data-testid="product-image-placeholder"
      >
        <PlaceholderImage size={48} aria-hidden="true" />
        <span className="text-xs font-medium">Görsel yakında</span>
      </div>
    )
  }

  return (
    <Image
      src={imageUrl}
      alt={alt}
      className={className}
      fill
      sizes={sizes}
      priority={priority}
      onError={() => setImageUrl(null)}
    />
  )
}

export default ProductImage
