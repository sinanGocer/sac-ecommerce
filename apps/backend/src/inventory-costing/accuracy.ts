/**
 * Tahmin doğruluğu (SAF): MAE / MAPE / bias. Öğrenme döngüsü haftalık değerlendirme.
 */

import { round2 } from "./inventory-costing-types"

export interface AccuracyPoint {
  predicted: number
  actual: number
}

export interface AccuracyResult {
  n: number
  mae: number
  mape: number | null
  bias: number
  /** model fazla mı tahmin ediyor (bias>0 → over-forecast). */
  tendency: "over_forecast" | "under_forecast" | "balanced"
}

export function computeAccuracy(points: AccuracyPoint[]): AccuracyResult {
  if (points.length === 0) {
    return { n: 0, mae: 0, mape: null, bias: 0, tendency: "balanced" }
  }
  let absErr = 0
  let pctErrSum = 0
  let pctCount = 0
  let biasSum = 0
  for (const p of points) {
    const err = p.predicted - p.actual
    absErr += Math.abs(err)
    biasSum += err
    if (p.actual !== 0) {
      pctErrSum += Math.abs(err) / Math.abs(p.actual)
      pctCount++
    }
  }
  const mae = round2(absErr / points.length)
  const mape = pctCount > 0 ? round2((pctErrSum / pctCount) * 100) : null
  const bias = round2(biasSum / points.length)
  return {
    n: points.length,
    mae,
    mape,
    bias,
    tendency: bias > 0.01 ? "over_forecast" : bias < -0.01 ? "under_forecast" : "balanced",
  }
}
