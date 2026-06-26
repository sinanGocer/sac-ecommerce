import { Container, clx } from "@modules/common/components/ui"
import React from "react"

import ProductImage from "@modules/products/components/product-image"

type ThumbnailProps = {
  thumbnail?: string | null
  images?: { url?: string }[] | null
  size?: "small" | "medium" | "large" | "full" | "square"
  isFeatured?: boolean
  priority?: boolean
  className?: string
  alt?: string
  "data-testid"?: string
}

const Thumbnail: React.FC<ThumbnailProps> = ({
  thumbnail,
  images,
  size = "small",
  isFeatured,
  priority,
  className,
  alt = "Ürün görseli",
  "data-testid": dataTestid,
}) => {
  return (
    <Container
      className={clx(
        "relative w-full overflow-hidden p-4 bg-ui-bg-subtle shadow-elevation-card-rest rounded-large group-hover:shadow-elevation-card-hover transition-shadow ease-in-out duration-150",
        className,
        {
          "aspect-[11/14]": isFeatured,
          "aspect-[9/16]": !isFeatured && size !== "square",
          "aspect-[1/1]": size === "square",
          "w-[180px]": size === "small",
          "w-[290px]": size === "medium",
          "w-[440px]": size === "large",
          "w-full": size === "full",
        }
      )}
      data-testid={dataTestid}
    >
      <ProductImage
        thumbnail={thumbnail}
        images={images}
        alt={alt}
        priority={priority}
        className="absolute inset-0 object-cover object-center"
        sizes="(max-width: 576px) 280px, (max-width: 768px) 360px, (max-width: 992px) 480px, 800px"
      />
    </Container>
  )
}

export default Thumbnail
