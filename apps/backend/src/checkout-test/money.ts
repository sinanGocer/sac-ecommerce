/**
 * Checkout Test Order — para (money) normalizasyonu (SAF, test edilebilir).
 *
 * Medusa cart/order money alanları BigNumber instance olarak gelir (JSON'da
 * sayı görünür ama `=== number` false). Bu yardımcılar BigNumber/string/number'ı
 * GÜVENLİ biçimde major-unit number'a normalize eder. Sessiz 0 fallback YOK;
 * parse edilemeyen değer `null` → fail-closed gate.
 */

/** number | numeric string | BigNumber-benzeri | null → number | null. */
export function normalizeMoney(value: unknown): number | null {
  if (value === null || value === undefined) return null

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === "string") {
    const s = value.trim()
    if (s.length === 0) return null
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }
  if (typeof value === "object") {
    const v = value as Record<string, unknown> & {
      toNumber?: () => unknown
      valueOf?: () => unknown
      toString?: () => string
    }
    // 1) Açık numeric property (BigNumber.numeric_ / .numeric / .value)
    for (const cand of [v["numeric"], v["numeric_"], v["value"]]) {
      if (typeof cand === "number" && Number.isFinite(cand)) return cand
      if (typeof cand === "string") {
        const n = Number(cand.trim())
        if (cand.trim().length > 0 && Number.isFinite(n)) return n
      }
    }
    // 2) toNumber()
    if (typeof v.toNumber === "function") {
      try {
        const n = v.toNumber()
        if (typeof n === "number" && Number.isFinite(n)) return n
      } catch {
        /* düş */
      }
    }
    // 3) valueOf() (BigNumber → number)
    if (typeof v.valueOf === "function") {
      const n = v.valueOf()
      if (typeof n === "number" && Number.isFinite(n)) return n
    }
    // 4) toString() → Number
    if (typeof v.toString === "function") {
      const s = v.toString()
      if (typeof s === "string" && s.trim().length > 0 && !/\[object/.test(s)) {
        const n = Number(s.trim())
        if (Number.isFinite(n)) return n
      }
    }
  }
  return null
}

export interface ShippingResolution {
  amount: number | null
  ok: boolean
  reason: string | null
}

/**
 * Shipping tutarını TEK anlamlı kaynaktan çözer. Tercih: cart shipping_total,
 * sonra shipping method total/amount. Birden fazla kaynak varsa TUTARLILIK gate:
 * çelişirse `ok=false` (complete bloklanır). `null` otomatik 0 sayılmaz.
 */
export function resolveShippingAmount(
  cartShippingTotal: unknown,
  methodTotal: unknown,
  methodAmount: unknown
): ShippingResolution {
  const cst = normalizeMoney(cartShippingTotal)
  const mt = normalizeMoney(methodTotal)
  const ma = normalizeMoney(methodAmount)
  const methodVal = mt ?? ma
  if (cst === null && methodVal === null) {
    return { amount: null, ok: false, reason: "shipping_amount_unresolved" }
  }
  if (cst !== null && methodVal !== null && cst !== methodVal) {
    return { amount: null, ok: false, reason: "shipping_source_conflict" }
  }
  return { amount: cst ?? methodVal, ok: true, reason: null }
}

export interface CartTotalsConsistency {
  ok: boolean
  reason: string | null
  normalized: {
    item_total: number | null
    shipping_total: number | null
    tax_total: number | null
    discount_total: number | null
    total: number | null
  }
}

/**
 * Cart toplam tutarlılığı:
 *   item_total + shipping_total + tax_total - discount_total === total
 * Herhangi bir money alanı parse edilemezse fail-closed (sessiz 0 yok).
 */
export function checkCartTotalsConsistency(input: {
  item_total: unknown
  shipping_total: unknown
  tax_total: unknown
  discount_total: unknown
  total: unknown
}): CartTotalsConsistency {
  const normalized = {
    item_total: normalizeMoney(input.item_total),
    shipping_total: normalizeMoney(input.shipping_total),
    tax_total: normalizeMoney(input.tax_total),
    discount_total: normalizeMoney(input.discount_total),
    total: normalizeMoney(input.total),
  }
  const values = Object.values(normalized)
  if (values.some((v) => v === null)) {
    return { ok: false, reason: "money_parse_failed", normalized }
  }
  const computed =
    normalized.item_total! +
    normalized.shipping_total! +
    normalized.tax_total! -
    normalized.discount_total!
  if (computed !== normalized.total!) {
    return { ok: false, reason: "total_arithmetic_mismatch", normalized }
  }
  return { ok: true, reason: null, normalized }
}
