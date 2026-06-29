/**
 * Audit kaydı üreticisi (SAF). actor, action, entity, before/after, timestamp,
 * idempotency. Secret ve müşteri PII alanları kayıttan ÇIKARILIR.
 */

export interface AuditEntry {
  actor_id: string
  action: string
  entity: string
  entity_id: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  idempotency_key: string | null
  timestamp: string
}

/** Audit'e asla yazılmayacak alanlar (secret + PII). */
export const AUDIT_FORBIDDEN_FIELDS: readonly string[] = [
  "password", "secret", "api_key", "apikey", "token", "jwt", "cookie",
  "email", "phone", "first_name", "last_name", "address", "customer_id",
  "card", "iban", "tax_id", "ip", "authorization",
]

function stripPii(value: unknown, forbidden: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((v) => stripPii(v, forbidden))
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (forbidden.has(k.toLowerCase())) continue
      out[k] = stripPii(v, forbidden)
    }
    return out
  }
  return value
}

export function buildAuditEntry(params: {
  actor_id: string
  action: string
  entity: string
  entity_id?: string | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  idempotency_key?: string | null
  now?: string
}): AuditEntry {
  const forbidden = new Set(AUDIT_FORBIDDEN_FIELDS)
  return {
    actor_id: params.actor_id,
    action: params.action,
    entity: params.entity,
    entity_id: params.entity_id ?? null,
    before: (stripPii(params.before ?? null, forbidden) as Record<string, unknown> | null),
    after: (stripPii(params.after ?? null, forbidden) as Record<string, unknown> | null),
    idempotency_key: params.idempotency_key ?? null,
    timestamp: params.now ?? new Date().toISOString(),
  }
}
