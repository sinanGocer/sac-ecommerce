import { HttpTypes } from "@medusajs/types"
import { Container } from "@modules/common/components/ui"
import ProductImage from "@modules/products/components/product-image"

type ImageGalleryProps = {
  images: HttpTypes.StoreProductImage[]
  thumbnail?: string | null
  productTitle: string
}

const ImageGallery = ({
  images,
  thumbnail,
  productTitle,
}: ImageGalleryProps) => {
  const galleryItems = images.length
    ? images
    : [{ id: "product-image-placeholder", url: null }]

  return (
    <div className="flex items-start relative">
      <div className="flex flex-col flex-1 small:mx-16 gap-y-4">
        {galleryItems.map((image, index) => {
          return (
            <Container
              key={image.id}
              className="relative aspect-[29/34] w-full overflow-hidden bg-ui-bg-subtle"
              id={image.id}
            >
              <ProductImage
                thumbnail={index === 0 ? thumbnail : image.url}
                images={index === 0 ? images : [image]}
                priority={index <= 2}
                className="absolute inset-0 rounded-rounded object-cover"
                alt={`${productTitle} görseli ${index + 1}`}
                sizes="(max-width: 576px) 280px, (max-width: 768px) 360px, (max-width: 992px) 480px, 800px"
              />
            </Container>
          )
        })}
      </div>
    </div>
  )
}

export default ImageGallery
