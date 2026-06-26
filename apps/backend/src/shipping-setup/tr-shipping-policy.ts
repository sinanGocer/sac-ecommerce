/**
 * Türkiye Shipping Setup — politika + tipler + env doğrulama (SAF, IO yok).
 *
 * Türkiye region/storefront checkout'u için fail-closed bir kurulum PLANI üretir:
 * stock location → sales-channel link → fulfillment set → service zone → tr geo
 * zone → manual_manual flat shipping option (+ opsiyonel free-threshold).
 *
 * Mevcut Avrupa service zone / European Warehouse DEĞİŞTİRİLMEZ. Ücret değerleri
 * hardcode EDİLMEZ; env ile verilir. Politika sürümü değişirse fingerprint değişir.
 */

export const TR_SHIPPING_SETUP_POLICY_VERSION = 1

/** Hedef kaynak isimleri (kimlik isimle değil, query ile çözülen ID'lerle kurulur). */
export const TARGET = {
  stock_location_name: "Türkiye Deposu",
  fulfillment_set_name: "Türkiye Teslimat",
  fulfillment_set_type: "shipping",
  service_zone_name: "Türkiye",
  country_code: "tr",
  provider_id: "manual_manual",
  currency: "try",
} as const

/** Bu kaynaklara ASLA dokunulmaz (Avrupa kurulumunu koru). */
export const PROTECTED = {
  stock_location_names: ["European Warehouse"],
  service_zone_names: ["Europe"],
} as const

// ── Env config ───────────────────────────────────────────────────────────────

export interface TrShippingConfig {
  option_name: string
  flat_amount: number
  currency: string
  free_threshold: number | null
}

export interface EnvParseResult {
  ok: boolean
  config: TrShippingConfig | null
  errors: string[]
}

/**
 * Env doğrulama (fail-closed). Currency yalnız `try`; flat amount pozitif tam
 * sayı (major unit); threshold opsiyonel, verilirse pozitif ve flat'tan büyük.
 * Açık değer verilmeden plan üretilmez (default ticari fiyat uydurulmaz).
 */
export function parseTrShippingEnv(
  env: Record<string, string | undefined>
): EnvParseResult {
  const errors: string[] = []
  const name = (env.TR_SHIPPING_OPTION_NAME ?? "").trim()
  const amountRaw = (env.TR_SHIPPING_FLAT_AMOUNT ?? "").trim()
  const currency = (env.TR_SHIPPING_CURRENCY ?? "").trim().toLowerCase()
  const thresholdRaw = (env.TR_SHIPPING_FREE_THRESHOLD ?? "").trim()

  if (name.length === 0) errors.push("TR_SHIPPING_OPTION_NAME zorunlu (boş olamaz)")

  let flatAmount = NaN
  if (amountRaw.length === 0) {
    errors.push("TR_SHIPPING_FLAT_AMOUNT zorunlu")
  } else if (!/^\d+$/.test(amountRaw)) {
    errors.push("TR_SHIPPING_FLAT_AMOUNT pozitif tam sayı olmalı (major unit)")
  } else {
    flatAmount = parseInt(amountRaw, 10)
    if (flatAmount <= 0) errors.push("TR_SHIPPING_FLAT_AMOUNT pozitif olmalı (>0)")
  }

  if (currency.length === 0) {
    errors.push("TR_SHIPPING_CURRENCY zorunlu")
  } else if (currency !== "try") {
    errors.push(`TR_SHIPPING_CURRENCY yalnız 'try' olabilir (verilen: '${currency}')`)
  }

  let freeThreshold: number | null = null
  if (thresholdRaw.length > 0) {
    if (!/^\d+$/.test(thresholdRaw)) {
      errors.push("TR_SHIPPING_FREE_THRESHOLD verilirse pozitif tam sayı olmalı")
    } else {
      freeThreshold = parseInt(thresholdRaw, 10)
      if (freeThreshold <= 0) {
        errors.push("TR_SHIPPING_FREE_THRESHOLD pozitif olmalı (>0)")
      } else if (Number.isFinite(flatAmount) && freeThreshold <= flatAmount) {
        errors.push("TR_SHIPPING_FREE_THRESHOLD flat amount'tan büyük olmalı")
      }
    }
  }

  if (errors.length > 0) return { ok: false, config: null, errors }
  return {
    ok: true,
    config: { option_name: name, flat_amount: flatAmount, currency, free_threshold: freeThreshold },
    errors: [],
  }
}

// ── Snapshot tipleri (script tarafından read-only doldurulur) ────────────────

export interface StockLocationRef {
  id: string
  name: string
  sales_channel_ids: string[]
  fulfillment_set_ids: string[]
}
export interface FulfillmentSetRef {
  id: string
  name: string
  type: string | null
  service_zone_ids: string[]
}
export interface ServiceZoneRef {
  id: string
  name: string
  fulfillment_set_id: string | null
  geo_country_codes: string[]
}
export interface ShippingOptionRef {
  id: string
  name: string
  provider_id: string | null
  price_type: string | null
  service_zone_id: string | null
  shipping_profile_id: string | null
  flat_amount: number | null
  currency: string | null
}

export interface TrShippingSnapshot {
  region_id: string | null
  region_currency: string | null
  region_countries: string[]
  sales_channel_id: string | null
  sales_channel_name: string | null
  shipping_profile_id: string | null
  shipping_profile_count: number
  stock_locations: StockLocationRef[]
  fulfillment_sets: FulfillmentSetRef[]
  service_zones: ServiceZoneRef[]
  shipping_options: ShippingOptionRef[]
}

export type StageId =
  | "STOCK_LOCATION_CREATE_OR_REUSE"
  | "STOCK_LOCATION_SALES_CHANNEL_LINK"
  | "FULFILLMENT_SET_CREATE_OR_REUSE"
  | "SERVICE_ZONE_CREATE_OR_REUSE"
  | "GEO_ZONE_TR_CREATE_OR_REUSE"
  | "SHIPPING_OPTION_CREATE_OR_REUSE"
  | "FREE_SHIPPING_RULE_CREATE_OR_REUSE"
  | "STORE_API_VISIBILITY_VERIFY"

export type StageStatus = "planned" | "no_op" | "skipped" | "conflict" | "blocked"

export interface StageResult {
  stage: StageId
  status: StageStatus
  executed: boolean
  estimated_writes: number
  current_state: Record<string, unknown>
  target_state: Record<string, unknown>
  dependency_ids: Record<string, string | null>
  gate: string | null
}

export type TrShippingDecision =
  | "TR_SHIPPING_SETUP_DRY_RUN_READY"
  | "TR_SHIPPING_SETUP_CONFLICT"
  | "TR_SHIPPING_SETUP_BLOCKED"
  | "TR_SHIPPING_SETUP_COMMITTED"
  | "TR_SHIPPING_SETUP_IDEMPOTENT_NOOP"
