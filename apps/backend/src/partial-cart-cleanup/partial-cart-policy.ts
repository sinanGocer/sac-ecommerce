/**
 * Partial Cart Cleanup — politika + tipler (SAF, IO yok).
 *
 * Önceki başarısız checkout execution'ından kalan TEK abandoned test cart'ını
 * güvenli biçimde temizler. Yaklaşım: SOFT-DELETE (audit korunur), hard delete
 * DEĞİL. Order/inventory/payment-capture'a dokunmaz. Dry-run varsayılan;
 * commit fail-closed (fingerprint confirm). Sadece allowlisted cart.
 */

export const PARTIAL_CART_CLEANUP_POLICY_VERSION = 1

/** TEK izinli partial cart (hardcoded allowlist). */
export const ALLOWLISTED_CART_ID = "cart_01KW2QT3TVSDAE3H5F4SGW93QW"

/**
 * Beklenen cart kimliği. Bunlardan biri bile uyuşmazsa cleanup planı üretilmez
 * (fail-closed). Yanlış/gerçek müşteri cart'ına asla dokunulmaz.
 */
export interface ExpectedCart {
  cart_id: string
  email: string
  variant_id: string
  shipping_option_id: string
  payment_provider_id: string
  quantity: number
  unit_price: number
  shipping_total: number
  total: number
  item_count: number
}

export const EXPECTED_CART: ExpectedCart = {
  cart_id: ALLOWLISTED_CART_ID,
  email: "checkout-e2e-test@invalid.example",
  variant_id: "variant_01KVQ6B203JZ6CJXD2FVAKQRJQ",
  shipping_option_id: "so_01KW2N2667K24EFHYKV55GY0WR",
  payment_provider_id: "pp_system_default",
  quantity: 1,
  unit_price: 169,
  shipping_total: 59,
  total: 228,
  item_count: 1,
}

// ── Snapshot (script tarafından read-only doldurulur) ────────────────────────

export interface PartialCartSnapshot {
  cart_id: string
  found: boolean
  deleted_at: string | null
  completed_at: string | null
  email: string | null
  item_count: number
  line: { variant_id: string | null; quantity: number | null; unit_price: number | null } | null
  shipping_option_id: string | null
  shipping_total: number | null
  total: number | null
  payment_collection_id: string | null
  payment_session_id: string | null
  payment_session_status: string | null
  payment_captured_amount: number
  payment_provider_id: string | null
  order_reference_count: number
  inventory_reservation_count: number
}

export type PartialCartActionStatus = "planned" | "no_op"

export interface PartialCartAction {
  action: "PAYMENT_SESSION_DELETE" | "CART_SOFT_DELETE"
  status: PartialCartActionStatus
  executed: boolean
  db_writes: number
  detail: Record<string, unknown>
}

export type PartialCartDecision =
  | "PARTIAL_CART_CLEANUP_DRY_RUN_READY"
  | "PARTIAL_CART_CLEANUP_PLAN_BLOCKED"
  | "PARTIAL_CART_CLEANUP_STALE_PLAN"
  | "PARTIAL_CART_CLEANUP_COMMITTED"
  | "PARTIAL_CART_CLEANUP_IDEMPOTENT_NOOP"
