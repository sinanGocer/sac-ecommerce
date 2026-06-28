/**
 * Salon Seed Cleanup — policy + types (safe, dry-run first).
 *
 * This cleanup targets only the five local salon seed demo products. It never
 * deletes products and it does not touch the quarantined KVKK/Aveda product.
 */

/**
 * Policy v2 — referans gate'i artık ham sayım değil, sınıflandırma temelli.
 *   - active cart / active order                      → block
 *   - gerçek/non-test historical order                → block
 *   - captured/refunded/fulfilled/returned order       → block
 *   - canceled + test + uncaptured + unfulfilled order → ENGEL DEĞİL
 *   - historical completed cart                        → ENGEL DEĞİL
 * Sınıflandırma read-only script tarafından yapılır; bu modül yalnız
 * türetilmiş sinyalleri (blocking_*) değerlendirir. Geçmiş order/cart
 * kayıtlarına dokunulmaz.
 */
export const SALON_SEED_CLEANUP_POLICY_VERSION = 2

export const TARGET_PRODUCT_STATUS = "draft" as const

export const ALLOWLISTED_SEED_PRODUCTS = [
  {
    product_id: "prod_01KVQ6B1ZA5BSQFQEEK1PWE3H7",
    handle: "sac-boyasi-7-0-kumral",
    title: "Profesyonel Saç Boyası 7.0 Kumral",
  },
  {
    product_id: "prod_01KVQ6B1ZASCV42QZF4QFGTH0T",
    handle: "oksidan-6-20vol-1000ml",
    title: "Oksidan Krem %6 (20 Vol) 1000 ml",
  },
  {
    product_id: "prod_01KVQ6B1ZAX6XJFD7TQPTYBFHF",
    handle: "onarici-keratin-sampuani-1000ml",
    title: "Onarıcı Keratin Şampuanı 1000 ml",
  },
  {
    product_id: "prod_01KVQ6B1ZAN5CYKY08TPHTVDTF",
    handle: "derin-bakim-sac-maskesi-500ml",
    title: "Derin Bakım Saç Maskesi 500 ml",
  },
  {
    product_id: "prod_01KVQ6B1ZA3HBYRM14NEVCK3YK",
    handle: "isi-koruyucu-sprey-200ml",
    title: "Isı Koruyucu Sprey 200 ml",
  },
] as const

export type CleanupActionType =
  | "PRODUCT_UNPUBLISH"
  | "SALES_CHANNEL_DETACH"
  | "PROJECTION_REMOVE_OR_HIDE"

export type CleanupActionStatus = "planned" | "no_op" | "blocked"

export interface SalesChannelRef {
  id: string
  name: string | null
}

export interface SeedProductSnapshot {
  product_id: string
  title: string | null
  handle: string | null
  status: string
  metadata: Record<string, unknown>
  variant_skus: string[]
  sales_channels: SalesChannelRef[]
  projection: { id: string; product_id: string } | null
}

export interface ProductReferenceCounts {
  /** completed_at==null && deleted_at==null cart satırları → blocking. */
  active_cart_lines: number
  /** completed_at!=null cart satırları → historical, blocking DEĞİL. */
  completed_cart_lines: number
  /** Ürünü içeren tüm order line sayısı (raporlama). */
  order_lines: number
  /** Order line miktarları toplamı (raporlama). */
  order_items: number
  /**
   * Blocking order line sayısı: active order, non-test historical order veya
   * captured/refunded/fulfilled/returned order satırları.
   */
  blocking_order_lines: number
  /**
   * Engellemeyen test order line sayısı: canceled + test_marker + uncaptured +
   * unfulfilled + no-return order satırları.
   */
  safe_test_order_lines: number
  variant_count: number
  price_count: number
  image_count: number
  sales_channel_relations: number
  category_relations: number
  projection_count: number
}

export interface PlannedSeedAction {
  product_id: string
  handle: string | null
  action: CleanupActionType
  status: CleanupActionStatus
  executed: false
  db_writes: 0
  detail: Record<string, unknown>
}

export type SalonSeedCleanupDecision =
  | "SALON_SEED_CLEANUP_DRY_RUN_READY"
  | "SALON_SEED_CLEANUP_BLOCKED"
  | "SALON_SEED_CLEANUP_SCOPE_MISMATCH"
  | "SALON_SEED_CLEANUP_COMMITTED"
  | "SALON_SEED_CLEANUP_IDEMPOTENT_NOOP"
