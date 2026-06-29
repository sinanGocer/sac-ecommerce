/**
 * Competitive Pricing — güvenli fiyat hesabı (SAF, deterministik).
 *
 * minimum_safe_price = maliyet + KDV etkisi + ödeme komisyonu + kargo katkısı +
 *                      platform maliyeti + minimum kâr
 * (KDV + komisyon SATIŞ fiyatı üzerinden alındığından gross-up uygulanır.)
 *
 * Önerilen fiyat = güvenilir en düşük toplam rakip fiyatından undercut kadar
 * düşük; ASLA minimum_safe_price altına inmez; liste fiyatı tavanı, anomali
 * filtresi, stok dışı dışlama, günlük max değişim, cooldown, stale-data ve
 * minimum güvenilir teklif kurallarına uyar.
 */

import {
  ACCEPTED_MATCH_CONFIDENCES,
  CompetitorOffer,
  MATCH_METHOD_CONFIDENCE,
  offerTotal,
  PriceDecision,
  PriceRuleConfig,
  SafePriceInputs,
} from "./pricing-policy"

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// ── minimum_safe_price ────────────────────────────────────────────────────────

export interface MinimumSafePriceResult {
  ok: boolean
  minimum_safe_price: number | null
  breakdown: Record<string, number>
  error: string | null
}

export function computeMinimumSafePrice(
  inputs: SafePriceInputs
): MinimumSafePriceResult {
  const baseCost =
    inputs.unit_cost + inputs.platform_cost + inputs.shipping_contribution
  const minProfit = Math.max(
    inputs.unit_cost * inputs.min_profit_rate,
    inputs.min_profit_abs
  )
  const requiredNet = baseCost + minProfit

  // Satış fiyatı P (KDV dahil) için merchant net oranı:
  //   net = P * (1/(1+vat) - commission)
  const netFactor = 1 / (1 + inputs.vat_rate) - inputs.payment_commission_rate
  if (netFactor <= 0) {
    return {
      ok: false,
      minimum_safe_price: null,
      breakdown: { required_net: round2(requiredNet), net_factor: round2(netFactor) },
      error: "net_factor_non_positive (vat+commission too high)",
    }
  }

  const price = requiredNet / netFactor
  const vatAmount = price * (inputs.vat_rate / (1 + inputs.vat_rate))
  const commissionAmount = price * inputs.payment_commission_rate

  return {
    ok: true,
    minimum_safe_price: round2(price),
    breakdown: {
      unit_cost: round2(inputs.unit_cost),
      platform_cost: round2(inputs.platform_cost),
      shipping_contribution: round2(inputs.shipping_contribution),
      min_profit: round2(minProfit),
      vat_amount: round2(vatAmount),
      commission_amount: round2(commissionAmount),
      required_net: round2(requiredNet),
    },
    error: null,
  }
}

// ── Önerilen fiyat ────────────────────────────────────────────────────────────

export interface SuggestedPriceInput {
  current_price: number
  list_price: number | null
  /** İşletme tabanı (manuel min). */
  floor_override: number | null
  /** İşletme tavanı (manuel max). */
  ceiling_override: number | null
  minimum_safe_price: number
  offers: CompetitorOffer[]
  /** Son fiyat değişimi (ISO) — cooldown için. null → cooldown yok. */
  last_change_at: string | null
  /** Şu anki zaman (ISO) — deterministik test için enjekte edilir. */
  now: string
  config: PriceRuleConfig
}

export interface SuggestedPriceResult {
  decision: PriceDecision
  suggested_price: number | null
  current_price: number
  effective_floor: number
  reliable_offer_count: number
  lowest_reliable_total: number | null
  excluded: { out_of_stock: number; wrong_volume: number; low_confidence: number; anomaly: number }
  reasons: string[]
}

function hoursBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 36e5
}

export function computeSuggestedPrice(
  input: SuggestedPriceInput
): SuggestedPriceResult {
  const { config, offers, now } = input
  const reasons: string[] = []
  const excluded = { out_of_stock: 0, wrong_volume: 0, low_confidence: 0, anomaly: 0 }

  const effectiveFloor = Math.max(
    input.minimum_safe_price,
    input.floor_override ?? 0
  )

  const base = (decision: PriceDecision, suggested: number | null, lowest: number | null, rc: number): SuggestedPriceResult => ({
    decision,
    suggested_price: suggested,
    current_price: input.current_price,
    effective_floor: round2(effectiveFloor),
    reliable_offer_count: rc,
    lowest_reliable_total: lowest,
    excluded,
    reasons,
  })

  // 1) Stale data gate — en yeni teklif çok eskiyse bloke.
  const freshness = offers.map((o) => hoursBetween(now, o.crawled_at))
  const newest = freshness.length ? Math.min(...freshness) : Infinity
  if (offers.length > 0 && newest > config.stale_competitor_hours) {
    reasons.push(`stale_data_${Math.round(newest)}h`)
    return base("BLOCKED_STALE_DATA", null, null, 0)
  }

  // 2) Teklif filtreleme: stok / hacim / güven.
  const reliable: number[] = []
  for (const o of offers) {
    if (!o.in_stock) { excluded.out_of_stock++; continue }
    if (!o.volume_match) { excluded.wrong_volume++; continue }
    const conf = MATCH_METHOD_CONFIDENCE[o.match_method]
    if (!ACCEPTED_MATCH_CONFIDENCES.includes(conf)) { excluded.low_confidence++; continue }
    reliable.push(offerTotal(o))
  }

  // 3) Anomali filtresi — medyanın çok altındaki tek ucuz teklifleri at.
  let candidate = reliable
  if (reliable.length >= 2) {
    const med = median(reliable)
    const floorBand = med * (1 - config.anomaly_below_median_ratio)
    candidate = reliable.filter((t) => {
      if (t < floorBand) { excluded.anomaly++; return false }
      return true
    })
  }

  if (candidate.length < config.min_reliable_offers) {
    reasons.push(`reliable_offers_${candidate.length}_lt_${config.min_reliable_offers}`)
    return base("BLOCKED_NO_RELIABLE_OFFERS", null, candidate.length ? round2(Math.min(...candidate)) : null, candidate.length)
  }

  const lowestReliable = Math.min(...candidate)

  // 4) Undercut hedefi.
  const undercut = config.undercut_ratio != null
    ? lowestReliable * config.undercut_ratio
    : config.undercut_abs
  let target = lowestReliable - undercut

  // 5) Floor (minimum_safe_price + işletme tabanı).
  if (target < effectiveFloor) {
    reasons.push("clamped_to_floor")
    target = effectiveFloor
  }

  // 6) Tavan (liste fiyatı + işletme tavanı).
  const ceilingCandidates = [input.list_price, input.ceiling_override].filter(
    (v): v is number => typeof v === "number" && v > 0
  )
  if (ceilingCandidates.length) {
    const ceiling = Math.min(...ceilingCandidates)
    if (target > ceiling) { reasons.push("clamped_to_ceiling"); target = ceiling }
  }

  // 7) Floor > ceiling ise güvenli taraf: değişiklik yok (taban korunur).
  if (target < effectiveFloor) {
    return base("BLOCKED_BELOW_FLOOR", null, round2(lowestReliable), candidate.length)
  }

  target = round2(target)

  // 8) Günlük maksimum değişim sınırı.
  const maxUp = input.current_price * (1 + config.max_daily_change_ratio)
  const maxDown = input.current_price * (1 - config.max_daily_change_ratio)
  if (target > maxUp) { reasons.push("capped_max_daily_up"); target = round2(maxUp) }
  if (target < maxDown) { reasons.push("capped_max_daily_down"); target = round2(maxDown) }
  // Daily cap floor'u ihlal etmesin.
  if (target < effectiveFloor) { target = round2(effectiveFloor) }

  // 9) Cooldown — son değişimden bu yana yeterli süre geçmediyse beklet.
  if (input.last_change_at && hoursBetween(now, input.last_change_at) < config.cooldown_hours) {
    reasons.push("cooldown_active")
    return base("HOLD_COOLDOWN", target, round2(lowestReliable), candidate.length)
  }

  // 10) Anlamlı değişim yoksa NO_CHANGE.
  if (Math.abs(target - input.current_price) < 0.01) {
    reasons.push("no_meaningful_change")
    return base("NO_CHANGE", target, round2(lowestReliable), candidate.length)
  }

  reasons.push("recommend")
  return base("RECOMMEND_CHANGE", target, round2(lowestReliable), candidate.length)
}
