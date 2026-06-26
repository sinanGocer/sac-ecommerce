const HTML_TAG_PATTERN = /<[^>]*>/g
const BREAK_PATTERN = /<\s*br\s*\/?\s*>/gi
const BLOCK_END_PATTERN = /<\s*\/\s*(p|div|li|h[1-6])\s*>/gi

const decodeBasicEntities = (value: string): string =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")

export const normalizeProductDescription = (
  value?: string | null
): string | null => {
  if (typeof value !== "string") {
    return null
  }

  const normalized = decodeBasicEntities(
    value
      .replace(BREAK_PATTERN, "\n")
      .replace(BLOCK_END_PATTERN, "\n")
      .replace(HTML_TAG_PATTERN, "")
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  return normalized || null
}
