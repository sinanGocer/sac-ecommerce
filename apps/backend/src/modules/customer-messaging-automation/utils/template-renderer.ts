const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g

export const renderTemplate = (
  value: string | null | undefined,
  payload: Record<string, unknown> | null | undefined
): string | null => {
  if (!value) return value ?? null

  return value.replace(VARIABLE_PATTERN, (_, key: string) => {
    const resolved = resolveValue(payload ?? {}, key)
    return resolved === null || resolved === undefined ? "" : String(resolved)
  })
}

const resolveValue = (payload: Record<string, unknown>, key: string): unknown =>
  key.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined
    return (current as Record<string, unknown>)[part]
  }, payload)
