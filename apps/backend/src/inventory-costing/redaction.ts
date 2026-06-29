/**
 * Yetki bazlı alan redaction (SAF). Hassas maliyet/tedarikçi/kâr alanları
 * catalog_editor'a response payload'ından ÇIKARILIR (yalnız UI gizleme değil —
 * API katmanı bu fonksiyonla payload'ı temizler). Owner/admin tam görür.
 */

export type ViewerRole = "owner" | "admin" | "catalog_editor"

/** catalog_editor'a ASLA gönderilmeyecek hassas alan adları. */
export const SENSITIVE_FIELDS: readonly string[] = [
  "unit_purchase_cost",
  "effective_unit_cost",
  "allocated_shipping_cost",
  "allocated_additional_cost",
  "supplier_id",
  "supplier_name",
  "invoice_number",
  "total_shipping_cost",
  "total_additional_cost",
  "stock_value",
  "fifo_stock_value",
  "weighted_average_cost",
  "last_purchase_cost",
  "min_purchase_cost",
  "max_purchase_cost",
  "net_profit",
  "gross_profit",
  "product_cost",
  "estimated_purchase_budget",
  "estimated_budget_last_cost",
  "estimated_budget_weighted_cost",
  "tied_up_capital",
  "unit_cost",
  "total_cost",
]

export function canViewCost(role: ViewerRole): boolean {
  return role === "owner" || role === "admin"
}

/**
 * RBAC role anahtarlarından görüntüleyici rolünü türetir. catalog_editor ise
 * (owner/admin değilse) maliyet alanları redaksiyon görür. Owner/admin yoksa ve
 * yalnız catalog_editor varsa → catalog_editor; aksi halde owner (tam) varsayımı
 * yalnız owner/admin anahtarı görülürse uygulanır.
 */
export function viewerRoleFromKeys(roleKeys: Iterable<string>): ViewerRole {
  const keys = new Set([...roleKeys].map((k) => k.toLowerCase()))
  const isEditor =
    keys.has("catalog_editor") || keys.has("role_catalog_editor") || keys.has("catalog editor")
  const isOwner =
    keys.has("owner") || keys.has("admin") || keys.has("super_admin") ||
    keys.has("role_owner") || keys.has("role_admin") || keys.has("role_super_admin")
  if (isOwner) return "owner"
  if (isEditor) return "catalog_editor"
  // Belirsizse en güvenli taraf: maliyet GÖSTERME.
  return "catalog_editor"
}

/** catalog_editor: hassas alanları derinlemesine siler. owner/admin: değiştirmez. */
export function redactForRole<T>(payload: T, role: ViewerRole): T {
  if (canViewCost(role)) return payload
  return deepRedact(payload, new Set(SENSITIVE_FIELDS)) as T
}

function deepRedact(value: unknown, sensitive: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((v) => deepRedact(v, sensitive))
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (sensitive.has(k)) continue
      out[k] = deepRedact(v, sensitive)
    }
    return out
  }
  return value
}
