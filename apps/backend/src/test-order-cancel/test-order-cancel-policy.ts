/**
 * Test Order Cancel — politika + tipler (SAF, IO yok).
 *
 * Kontrollü test siparişini Medusa resmi `cancelOrderWorkflow` ile iptale
 * HAZIRLAR (cancel-not-delete; order/audit korunur, reservation serbest, capture
 * 0 olduğundan refund yok). Dry-run varsayılan; commit fail-closed. Sadece
 * allowlisted order. Hard delete YOK.
 */

export const TEST_ORDER_CANCEL_POLICY_VERSION = 1

/** TEK izinli order (hardcoded allowlist). */
export const ALLOWLISTED_ORDER_ID = "order_01KW4SCBXVARCMCN14JBKQ4FBZ"

export interface ExpectedOrder {
  order_id: string
  display_id: number
  email: string
  currency: string
  total: number
  item_count: number
  variant_id: string
  sku: string
  quantity: number
  unit_price: number
  shipping_method_name: string
  shipping_amount: number
  payment_provider_id: string
  authorized_amount: number
  captured_amount: number
  reservation_count: number
  reservation_quantity: number
}

export const EXPECTED_ORDER: ExpectedOrder = {
  order_id: ALLOWLISTED_ORDER_ID,
  display_id: 1,
  email: "checkout-e2e-test@invalid.example",
  currency: "try",
  total: 228,
  item_count: 1,
  variant_id: "variant_01KVQ6B203JZ6CJXD2FVAKQRJQ",
  sku: "ISI-KORUYUCU-SPREY-200ML-1",
  quantity: 1,
  unit_price: 169,
  shipping_method_name: "Türkiye Standart Kargo",
  shipping_amount: 59,
  payment_provider_id: "pp_system_default",
  authorized_amount: 228,
  captured_amount: 0,
  reservation_count: 1,
  reservation_quantity: 1,
}

// ── Snapshot (script tarafından read-only doldurulur) ────────────────────────

export interface TestOrderSnapshot {
  order_id: string
  found: boolean
  deleted_at: string | null
  canceled_at: string | null
  status: string | null
  display_id: number | null
  email: string | null
  currency: string | null
  /** authoritative total (summary.current_order_total/original/accounting). */
  authoritative_total: number | null
  item_count: number
  line: { variant_id: string | null; sku: string | null; quantity: number | null; unit_price: number | null } | null
  shipping_method_name: string | null
  shipping_amount: number | null
  payment_provider_id: string | null
  authorized_amount: number
  captured_amount: number
  refund_amount: number
  payment_status: string | null
  fulfillment_count: number
  return_count: number
  exchange_count: number
  claim_count: number
  has_test_marker: boolean
  reservation_ids: string[]
  reservation_quantity: number
  reservation_inventory_item_id: string | null
  inventory_item_id: string | null
  inventory_stocked: number | null
  inventory_reserved: number | null
  // duplicate gate bağlamı (read-only)
  active_partial_cart_count: number
  other_active_test_order_count: number
}

export type CancelActionStatus = "planned" | "no_op"

export interface CancelAction {
  action: "ORDER_CANCEL" | "RESERVATION_RELEASE" | "PAYMENT_AUTHORIZATION_CANCEL"
  status: CancelActionStatus
  executed: boolean
  /** workflow-internal alt aksiyon mu (tek cancelOrderWorkflow içinde). */
  workflow_internal: boolean
  detail: Record<string, unknown>
}

export type TestOrderCancelDecision =
  | "TEST_ORDER_CANCEL_DRY_RUN_READY"
  | "TEST_ORDER_CANCEL_PLAN_BLOCKED"
  | "TEST_ORDER_CANCEL_STALE_PLAN"
  | "TEST_ORDER_CANCEL_COMMITTED"
  | "TEST_ORDER_CANCEL_IDEMPOTENT_NOOP"
  | "TEST_ORDER_CANCEL_PARTIAL_FAILURE"
