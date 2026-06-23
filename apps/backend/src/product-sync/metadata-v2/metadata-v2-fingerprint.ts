import { createHash } from "crypto"

export function metadataFingerprint(
  metadata: Record<string, unknown>
): string {
  return createHash("sha256").update(stableJson(metadata)).digest("hex")
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!isRecord(value)) return value

  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortValue(value[key])
  }
  return sorted
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
