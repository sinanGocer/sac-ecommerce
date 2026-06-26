type ProductImageSource = {
  url?: string | null
}

type ProductImageInput = {
  thumbnail?: string | null
  images?: ProductImageSource[] | null
}

export const normalizeProductImageUrl = (
  value?: string | null
): string | null => {
  if (typeof value !== "string") {
    return null
  }

  const normalized = value.trim()

  if (!normalized || normalized === "null" || normalized === "undefined") {
    return null
  }

  if (normalized.startsWith("/")) {
    return normalized.startsWith("//") ? null : normalized
  }

  try {
    const url = new URL(normalized)

    return url.protocol === "https:" && url.hostname ? url.toString() : null
  } catch {
    return null
  }
}

export const resolveProductImageUrl = ({
  thumbnail,
  images,
}: ProductImageInput): string | null => {
  const normalizedThumbnail = normalizeProductImageUrl(thumbnail)

  if (normalizedThumbnail) {
    return normalizedThumbnail
  }

  for (const image of images ?? []) {
    const normalizedImage = normalizeProductImageUrl(image?.url)

    if (normalizedImage) {
      return normalizedImage
    }
  }

  return null
}
