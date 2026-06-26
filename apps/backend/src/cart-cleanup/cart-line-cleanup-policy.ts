/**
 * Cart Line Cleanup — politika + tipler (SAF, IO yok).
 *
 * Quarantine sonrası: hatalı KVKK ürünü `draft` + tüm sales channel'lardan çıkmış
 * + projection silinmiş; ancak 1 AKTİF (anonim, abandoned) cart hâlâ bu ürünün
 * bir satırını tutuyor ve platform/storefront bunu checkout'tan gate'lemiyor
 * (manage_inventory:false). Bu araç YALNIZ o tek hedef satırı kaldırır;
 * cart'taki diğer meşru satırlara DOKUNMAZ, cart'ı silmez, order'a dokunmaz.
 *
 * Politika sürümü değişirse fingerprint değişir → eski confirm token geçersiz.
 */

export const CART_CLEANUP_POLICY_VERSION = 1

/** TEK izinli cart (hardcoded allowlist). */
export const ALLOWLISTED_CART_ID = "cart_01KVQYNXS7AA20S356ACX0KDZN"
/** TEK izinli line item (hardcoded allowlist). */
export const ALLOWLISTED_LINE_ITEM_ID = "cali_01KVQYNXX9FYKMT4Z2NSVF7S32"

/**
 * Beklenen hedef satır kimliği. Plan üretilmeden önce mevcut cart verisi bununla
 * karşılaştırılır; herhangi biri uyuşmazsa CART_CLEANUP_STALE_PLAN (fail-closed).
 */
export interface ExpectedTarget {
  cart_id: string
  line_item_id: string
  product_id: string
  variant_id: string
  quantity: number
  unit_price: number
}

export const EXPECTED_TARGET: ExpectedTarget = {
  cart_id: ALLOWLISTED_CART_ID,
  line_item_id: ALLOWLISTED_LINE_ITEM_ID,
  product_id: "prod_01KVQHSEDTH4K5049T9PV9WPZM",
  variant_id: "variant_01KVQHSEE96SKKXW9Y43HDB5PS",
  quantity: 1,
  unit_price: 2119,
}

// ── Snapshot tipleri (script tarafından read-only doldurulur) ────────────────

export interface CartLineItemRef {
  id: string
  product_id: string | null
  variant_id: string | null
  quantity: number | null
  unit_price: number | null
  title: string | null
}

export interface CartSnapshot {
  cart_id: string
  completed_at: string | null
  payment_collection_exists: boolean
  payment_collection_status: string | null
  payment_captured_amount: number
  payment_sessions: number
  items: CartLineItemRef[]
}

export interface CartReferenceCounts {
  /** Bu cart için order referansı (cart tamamlanmış/order'a dönmüş mü). */
  order_reference_count: number
  total_line_items: number
  other_line_items: number
}

export type CartCleanupActionStatus = "planned" | "no_op"

export interface CartCleanupAction {
  action: "CART_LINE_REMOVE"
  status: CartCleanupActionStatus
  executed: boolean
  db_writes: number
  detail: Record<string, unknown>
}

export type CartCleanupDecision =
  | "CART_CLEANUP_DRY_RUN_READY"
  | "CART_CLEANUP_PLAN_BLOCKED"
  | "CART_CLEANUP_STALE_PLAN"
  | "CART_CLEANUP_COMMITTED"
  | "CART_CLEANUP_IDEMPOTENT_NOOP"
