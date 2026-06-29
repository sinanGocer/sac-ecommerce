/**
 * Talep tahmini (SAF, AÇIKLANABİLİR — kara kutu ML yok).
 *
 * Weighted moving average + exponential smoothing + trend düzeltme + stockout
 * correction + cold-start. Canceled/test/refund satışlar (excluded) ve stokta
 * olmayan günler GERÇEK talep sayılmaz. Yetersiz veride kategori medyanı /
 * manuel aylık tahmin / düşük confidence.
 */

import { DailySale, round2 } from "./inventory-costing-types"

export interface ForecastInput {
  history: DailySale[]
  horizon_days: number
  /** Yeterli veri yoksa kullanılacak kategori/benzer ürün günlük medyanı. */
  category_daily_median?: number | null
  /** Kullanıcının manuel aylık satış beklentisi (cold-start/override). */
  manual_monthly_demand?: number | null
}

export interface ForecastResult {
  daily_average: number
  weekly_average: number
  trend_30_60_90: { d30: number; d60: number; d90: number }
  predicted_demand: number
  lower_bound: number
  upper_bound: number
  confidence_score: number
  model_version: string
  classification: "fast_moving" | "normal" | "slow_moving" | "no_data"
  reason_codes: string[]
}

const MODEL_VERSION = "explainable-wma-v1"

/** Gerçek talep günleri: excluded ve out_of_stock olmayanlar. */
function realDemandDays(history: DailySale[]): DailySale[] {
  return history.filter((d) => !d.excluded && !d.out_of_stock)
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Son N günün ağırlıklı ortalaması (yeni günler ağır). */
function weightedMovingAverage(qtys: number[], window: number): number {
  const slice = qtys.slice(-window)
  if (!slice.length) return 0
  let wsum = 0
  let num = 0
  slice.forEach((q, i) => {
    const w = i + 1
    wsum += w
    num += q * w
  })
  return wsum ? num / wsum : 0
}

/** Üssel düzleştirme. */
function exponentialSmoothing(qtys: number[], alpha: number): number {
  if (!qtys.length) return 0
  let s = qtys[0]
  for (let i = 1; i < qtys.length; i++) s = alpha * qtys[i] + (1 - alpha) * s
  return s
}

function sumWindow(days: DailySale[], n: number): number {
  return days.slice(-n).reduce((a, d) => a + d.quantity, 0)
}

export function forecastDemand(input: ForecastInput): ForecastResult {
  const horizon = Math.max(1, input.horizon_days)
  const real = realDemandDays(input.history)
  const reasons: string[] = []

  // Cold-start / yetersiz veri.
  if (real.length < 7) {
    let daily = 0
    let confidence = 0.2
    if (input.manual_monthly_demand && input.manual_monthly_demand > 0) {
      daily = input.manual_monthly_demand / 30
      reasons.push("manual_monthly_demand")
      confidence = 0.35
    } else if (input.category_daily_median && input.category_daily_median > 0) {
      daily = input.category_daily_median
      reasons.push("category_median_fallback")
      confidence = 0.25
    } else {
      reasons.push("insufficient_data")
    }
    const predicted = round2(daily * horizon)
    return {
      daily_average: round2(daily),
      weekly_average: round2(daily * 7),
      trend_30_60_90: { d30: round2(daily * 30), d60: round2(daily * 60), d90: round2(daily * 90) },
      predicted_demand: predicted,
      lower_bound: round2(predicted * 0.4),
      upper_bound: round2(predicted * 1.8),
      confidence_score: confidence,
      model_version: MODEL_VERSION,
      classification: real.length === 0 ? "no_data" : "slow_moving",
      reason_codes: reasons,
    }
  }

  const qtys = real.map((d) => d.quantity)
  const wma = weightedMovingAverage(qtys, 14)
  const es = exponentialSmoothing(qtys, 0.4)
  const recentAvg = mean(qtys.slice(-7))
  const olderAvg = mean(qtys.slice(-30, -7))

  // Trend faktörü (son 7 gün vs önceki) — sınırlı.
  let trend = 1
  if (olderAvg > 0) {
    trend = Math.min(1.5, Math.max(0.6, recentAvg / olderAvg))
    if (trend > 1.1) reasons.push("rising_trend")
    else if (trend < 0.9) reasons.push("falling_trend")
  }

  // Stockout correction: out_of_stock günler talebi bastırmış olabilir → hafif yukarı.
  const stockoutDays = input.history.filter((d) => d.out_of_stock).length
  let stockoutFactor = 1
  if (stockoutDays > 0) {
    stockoutFactor = 1 + Math.min(0.3, stockoutDays / Math.max(1, input.history.length))
    reasons.push("stockout_corrected")
  }

  const baseDaily = ((wma + es) / 2) * trend * stockoutFactor
  const daily = Math.max(0, baseDaily)
  const predicted = round2(daily * horizon)

  // Confidence: veri uzunluğu + tutarlılık (CV düşükse yüksek).
  const m = mean(qtys)
  const variance = mean(qtys.map((q) => (q - m) ** 2))
  const cv = m > 0 ? Math.sqrt(variance) / m : 1
  let confidence = Math.min(0.95, 0.4 + Math.min(0.3, real.length / 90 * 0.3) + Math.max(0, 0.25 - cv * 0.1))
  confidence = round2(confidence)

  const band = 1 + cv
  const dailyTotal = mean(qtys) || daily
  const classification: ForecastResult["classification"] =
    dailyTotal >= 1 ? "fast_moving" : dailyTotal >= 0.2 ? "normal" : "slow_moving"

  return {
    daily_average: round2(daily),
    weekly_average: round2(daily * 7),
    trend_30_60_90: { d30: sumWindow(real, 30), d60: sumWindow(real, 60), d90: sumWindow(real, 90) },
    predicted_demand: predicted,
    lower_bound: round2(predicted / band),
    upper_bound: round2(predicted * band),
    confidence_score: confidence,
    model_version: MODEL_VERSION,
    classification,
    reason_codes: reasons,
  }
}
