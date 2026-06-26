/**
 * Checkout Test Order — politika + tipler (SAF, IO yok).
 *
 * pp_system_default (manuel/test) ile UÇTAN UCA tek bir kontrollü test siparişi
 * PLANI üretir. Gerçek ödeme değildir; production müşteri verisi içermez.
 * Dry-run varsayılan; commit fail-closed (fingerprint confirm). İlk aşamada
 * YALNIZ plan; hiçbir cart/order/payment mutation yapılmaz.
 */

export const CHECKOUT_TEST_ORDER_POLICY_VERSION = 1

/** Ayırt edilebilir test e-postası (dışarıya teslim edilmez — .invalid TLD). */
export const TEST_EMAIL = "checkout-e2e-test@invalid.example"

/** Test shipping adresi (gerçek kişi verisi YOK). */
export const TEST_ADDRESS = {
  first_name: "Test",
  last_name: "Sipariş",
  address_1: "Test Adresi 1",
  city: "Ankara",
  province: "Ankara",
  postal_code: "06000",
  country_code: "tr",
  phone: "+905000000000",
} as const

/** Cart/order test işareti metadata'sı. */
export const TEST_METADATA = {
  test_order: true,
  test_purpose: "manual-payment-checkout-e2e",
  created_by: "controlled-checkout-test",
} as const

export const COUNTRY_CODE = "tr"
export const CURRENCY = "try"
export const QUANTITY = 1
export const PAYMENT_PROVIDER_ID = "pp_system_default"

/**
 * Beklenen test ürünü kimliği (canlı query ile çözüldü; runtime'da yeniden
 * doğrulanır — ada kör güvenilmez). Tek-variant, published, TRY fiyatlı, en
 * düşük fiyatlılardan; junk/KVKK ürünü DEĞİL.
 */
export const EXPECTED_PRODUCT = {
  product_id: "prod_01KVQ6B1ZA3HBYRM14NEVCK3YK",
  title: "Isı Koruyucu Sprey 200 ml",
  handle: "isi-koruyucu-sprey-200ml",
  variant_id: "variant_01KVQ6B203JZ6CJXD2FVAKQRJQ",
  sku: "ISI-KORUYUCU-SPREY-200ML-1",
  unit_price: 169,
  manage_inventory: true,
  variant_count: 1,
} as const

/** Beklenen TR shipping option (önceki setup'tan; runtime'da doğrulanır). */
export const EXPECTED_SHIPPING = {
  option_id: "so_01KW2N2667K24EFHYKV55GY0WR",
  name: "Türkiye Standart Kargo",
  provider_id: "manual_manual",
  amount: 59,
  service_zone_name: "Türkiye",
} as const

/** Maliyet sınırı: yanlış ürün/fiyatla sipariş engellenir. */
export const MAX_ITEM_SUBTOTAL = EXPECTED_PRODUCT.unit_price * QUANTITY // 169
export const MAX_SHIPPING_AMOUNT = EXPECTED_SHIPPING.amount // 59
/** Vergi 0 (TR tax_region'da rate yok) → beklenen tavan. */
export const MAX_ORDER_TOTAL = MAX_ITEM_SUBTOTAL + MAX_SHIPPING_AMOUNT // 228

// ── Snapshot tipleri (script tarafından read-only doldurulur) ────────────────

export interface ProductSnap {
  id: string
  status: string
  in_sales_channel: boolean
  variant_id: string | null
  sku: string | null
  unit_price: number | null
  currency: string | null
  manage_inventory: boolean | null
  variant_count: number
  reservable_quantity: number
  shipping_profile_id: string | null
}

export interface ShippingOptionSnap {
  id: string
  name: string
  provider_id: string | null
  amount: number | null
  currency: string | null
  service_zone_name: string | null
  is_europe: boolean
}

export interface PaymentProviderSnap {
  id: string
  is_enabled: boolean
}

export interface CheckoutTestSnapshot {
  region_id: string | null
  region_currency: string | null
  region_countries: string[]
  sales_channel_id: string | null
  sales_channel_name: string | null
  publishable_key_identity: string | null
  tax_rate: number
  product: ProductSnap | null
  shipping_option: ShippingOptionSnap | null
  payment_provider: PaymentProviderSnap | null
}

export type StageId =
  | "PRODUCT_AND_VARIANT_RESOLVE"
  | "SHIPPING_OPTION_RESOLVE"
  | "PAYMENT_PROVIDER_RESOLVE"
  | "TEST_CART_CREATE"
  | "LINE_ITEM_ADD"
  | "EMAIL_AND_ADDRESS_SET"
  | "SHIPPING_METHOD_ADD"
  | "PAYMENT_COLLECTION_CREATE"
  | "PAYMENT_SESSION_INITIALIZE"
  | "PRE_COMPLETE_REVALIDATE"
  | "CART_COMPLETE"
  | "ORDER_READ_BACK_VERIFY"

export type StageKind = "resolve" | "mutation" | "verify"
export type StageStatus = "ready" | "planned" | "blocked"

export interface StageResult {
  stage: StageId
  kind: StageKind
  status: StageStatus
  executed: boolean
  estimated_mutations: number
  detail: Record<string, unknown>
  gate: string | null
}

export interface ExpectedTotals {
  subtotal: number
  shipping_total: number
  tax_total: number
  grand_total: number
}

export type CheckoutTestDecision =
  | "CHECKOUT_TEST_ORDER_DRY_RUN_READY"
  | "CHECKOUT_TEST_ORDER_BLOCKED"
  | "CHECKOUT_TEST_ORDER_CONFLICT"
  | "CHECKOUT_TEST_ORDER_COMMITTED"
