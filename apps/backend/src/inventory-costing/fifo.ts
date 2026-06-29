/**
 * FIFO maliyet tahsisi + ters kayıt (SAF, deterministik).
 *
 * En eski (received_at) ve kalan miktarı olan lot önce tüketilir. Tek satış
 * birden çok lota bölünebilir; her allocation kendi birim maliyetini saklar.
 * Oversell engellenir. Hiçbir DB yazımı yapılmaz — yalnız plan üretir; çağıran
 * transaction içinde uygular.
 */

import {
  CostLot,
  FifoAllocationLine,
  round2,
} from "./inventory-costing-types"

export interface FifoAllocationResult {
  ok: boolean
  lines: FifoAllocationLine[]
  allocated_quantity: number
  total_cost: number
  /** Karşılanamayan miktar (oversell). >0 ise ok=false. */
  shortfall: number
  error: string | null
}

/** active + kalanı olan lotları received_at'e (eşitlikte lot_id) göre sıralar. */
function fifoOrder(lots: CostLot[]): CostLot[] {
  return [...lots]
    .filter((l) => l.status === "active" && l.remaining_quantity > 0)
    .sort((a, b) => {
      const t = new Date(a.received_at).getTime() - new Date(b.received_at).getTime()
      return t !== 0 ? t : a.lot_id.localeCompare(b.lot_id)
    })
}

/**
 * FIFO tahsis planı. quantity karşılanamıyorsa fail-closed (shortfall>0, ok=false)
 * → çağıran satışı/oversell'i engeller.
 */
export function allocateFifo(
  lots: CostLot[],
  quantity: number
): FifoAllocationResult {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, lines: [], allocated_quantity: 0, total_cost: 0, shortfall: 0, error: "invalid_quantity" }
  }
  const ordered = fifoOrder(lots)
  const lines: FifoAllocationLine[] = []
  let remaining = quantity
  let totalCost = 0

  for (const lot of ordered) {
    if (remaining <= 0) break
    const take = Math.min(lot.remaining_quantity, remaining)
    if (take <= 0) continue
    const lineCost = round2(take * lot.effective_unit_cost)
    lines.push({
      lot_id: lot.lot_id,
      allocated_quantity: take,
      unit_cost: round2(lot.effective_unit_cost),
      total_cost: lineCost,
    })
    totalCost = round2(totalCost + lineCost)
    remaining -= take
  }

  const allocated = quantity - remaining
  if (remaining > 0) {
    return {
      ok: false,
      lines,
      allocated_quantity: allocated,
      total_cost: round2(totalCost),
      shortfall: remaining,
      error: "insufficient_stock_oversell_blocked",
    }
  }
  return { ok: true, lines, allocated_quantity: allocated, total_cost: round2(totalCost), shortfall: 0, error: null }
}

/** Ağırlıklı ortalama birim maliyet (kalan stok üzerinden). */
export function weightedAverageCost(lots: CostLot[]): number | null {
  let qty = 0
  let value = 0
  for (const l of lots) {
    if (l.status !== "active" || l.remaining_quantity <= 0) continue
    qty += l.remaining_quantity
    value += l.remaining_quantity * l.effective_unit_cost
  }
  return qty > 0 ? round2(value / qty) : null
}

/** Son alış (en yeni received_at) efektif birim maliyeti. */
export function lastPurchaseCost(lots: CostLot[]): number | null {
  const sorted = [...lots]
    .filter((l) => l.status === "active" || l.status === "depleted")
    .sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime())
  return sorted.length ? round2(sorted[0].effective_unit_cost) : null
}

/** FIFO sıradaki ilk (en eski kalan) lotun maliyeti — bir sonraki satışın maliyeti. */
export function nextFifoUnitCost(lots: CostLot[]): number | null {
  const ordered = fifoOrder(lots)
  return ordered.length ? round2(ordered[0].effective_unit_cost) : null
}

export interface ReversalResult {
  ok: boolean
  /** lot_id → geri eklenecek miktar. */
  restored: Array<{ lot_id: string; quantity: number; unit_cost: number }>
  error: string | null
}

/**
 * İptal/iade ters kaydı: allocation satırlarını ÖZGÜN lotlara geri döndürür.
 * allocation silinmez; çağıran reversal kaydı yazar. `alreadyReversed` true ise
 * idempotent no-op (aynı reversal iki kez uygulanmaz).
 */
export function reverseAllocation(
  allocationLines: FifoAllocationLine[],
  alreadyReversed: boolean
): ReversalResult {
  if (alreadyReversed) {
    return { ok: true, restored: [], error: "already_reversed_noop" }
  }
  for (const l of allocationLines) {
    if (l.allocated_quantity <= 0) {
      return { ok: false, restored: [], error: "invalid_allocation_quantity" }
    }
  }
  return {
    ok: true,
    restored: allocationLines.map((l) => ({
      lot_id: l.lot_id,
      quantity: l.allocated_quantity,
      unit_cost: l.unit_cost,
    })),
    error: null,
  }
}
