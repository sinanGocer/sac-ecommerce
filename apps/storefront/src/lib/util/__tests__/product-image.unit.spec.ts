import {
  normalizeProductImageUrl,
  resolveProductImageUrl,
} from "../product-image"

const assertEqual = (actual: unknown, expected: unknown, message: string) => {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`)
  }
}

export const runProductImageAssertions = () => {
  const thumbnail = "https://cdn.example.com/product.jpg"
  const fallback = "https://cdn.example.com/fallback.jpg"

  assertEqual(
    resolveProductImageUrl({ thumbnail, images: [{ url: fallback }] }),
    thumbnail,
    "valid thumbnail has priority"
  )
  assertEqual(
    resolveProductImageUrl({ thumbnail: "  ", images: [{ url: fallback }] }),
    fallback,
    "empty thumbnail falls back to first valid image"
  )
  assertEqual(
    resolveProductImageUrl({
      thumbnail: "not a url",
      images: [{ url: fallback }],
    }),
    fallback,
    "malformed thumbnail falls back to first valid image"
  )
  assertEqual(
    resolveProductImageUrl({ thumbnail: null, images: [] }),
    null,
    "missing sources use the placeholder"
  )
  assertEqual(
    normalizeProductImageUrl("http://cdn.example.com/product.jpg"),
    null,
    "insecure remote images are rejected"
  )
  assertEqual(
    normalizeProductImageUrl("  https://cdn.example.com/travel-40ml.jpg  "),
    "https://cdn.example.com/travel-40ml.jpg",
    "travel product images are trimmed and preserved"
  )
}
