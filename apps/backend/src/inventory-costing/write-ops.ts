/**
 * Yazma planı üreticileri (SAF, deterministik). DB'ye DOKUNMAZ — yalnız servis/
 * workflow'un transaction içinde uygulayacağı satır planlarını üretir. Böylece
 * stok girişi / FIFO tüketimi / reversal mantığı tam test edilebilir.
 */

import { allocateFifo } from "./fifo"
import { CostLot, round2 } from "./inventory-costing-types"
import { reverseAllocation } from "./fifo"
import {
  StockEntryInput,
  validateAndComputeStockEntry,
} from "./stock-entry"

// ── Stok girişi planı ─────────────────────────────────────────────────────────

export interface StockEntryPlan {
  ok: boolean
  errors: string[]
  /** idempotency_key zaten varsa true → çağıran no-op döner. */
  effective_unit_cost: number | null
  receipt: {
    supplier_id: string | null
    supplier_name: string | null
    invoice_number: string | null
    receipt_date: string
    currency: string
    total_shipping_cost: number
    total_additional_cost: number
    notes: string | null
  } | null
  lot: {
    product_id: string
    variant_id: string
    inventory_item_id: string | null
    location_id: string | null
    lot_number: string | null
    received_quantity: number
    remaining_quantity: number
    reserved_quantity: number
    unit_purchase_cost: number
    purchase_vat_rate: number
    allocated_shipping_cost: number
    allocated_additional_cost: number
    effective_unit_cost: number
    received_at: string
    expiry_date: string | null
    status: string
    idempotency_key: string
  } | null
  /** Medusa inventory level'a eklenecek miktar (workflow uygular). */
  inventory_delta: number
}

export interface StockEntryFull extends StockEntryInput {
  location_id?: string | null
  inventory_item_id?: string | null
  supplier_id?: string | null
  supplier_name?: string | null
  invoice_number?: string | null
  lot_number?: string | null
  received_at?: string | null
  expiry_date?: string | null
  currency?: string | null
  notes?: string | null
}

export function planStockEntry(input: StockEntryFull): StockEntryPlan {
  const v = validateAndComputeStockEntry(input)
  // Ek zorunlu alan doğrulaması.
  const errors = [...v.errors]
  if (!input.location_id) errors.push("missing_location")
  if (!input.supplier_id && !input.supplier_name) errors.push("missing_supplier")
  if (!input.invoice_number) errors.push("missing_invoice_number")
  if (!input.lot_number) errors.push("missing_lot_number")

  if (errors.length > 0 || v.effective_unit_cost === null) {
    return { ok: false, errors, effective_unit_cost: null, receipt: null, lot: null, inventory_delta: 0 }
  }

  const now = input.received_at || new Date().toISOString()
  return {
    ok: true,
    errors: [],
    effective_unit_cost: v.effective_unit_cost,
    receipt: {
      supplier_id: input.supplier_id ?? null,
      supplier_name: input.supplier_name ?? null,
      invoice_number: input.invoice_number ?? null,
      receipt_date: now,
      currency: (input.currency || "try").toLowerCase(),
      total_shipping_cost: input.allocated_shipping_cost ?? 0,
      total_additional_cost: input.allocated_additional_cost ?? 0,
      notes: input.notes ?? null,
    },
    lot: {
      product_id: input.product_id,
      variant_id: input.variant_id,
      inventory_item_id: input.inventory_item_id ?? null,
      location_id: input.location_id ?? null,
      lot_number: input.lot_number ?? null,
      received_quantity: input.received_quantity,
      remaining_quantity: input.received_quantity, // remaining = received
      reserved_quantity: 0,
      unit_purchase_cost: input.unit_purchase_cost,
      purchase_vat_rate: input.purchase_vat_rate,
      allocated_shipping_cost: input.allocated_shipping_cost ?? 0,
      allocated_additional_cost: input.allocated_additional_cost ?? 0,
      effective_unit_cost: v.effective_unit_cost,
      received_at: now,
      expiry_date: input.expiry_date ?? null,
      status: "active",
      idempotency_key: input.idempotency_key,
    },
    inventory_delta: input.received_quantity,
  }
}

// ── FIFO tüketim planı (sipariş) ──────────────────────────────────────────────

export interface FifoConsumptionPlan {
  ok: boolean
  allocations: Array<{
    lot_id: string
    allocated_quantity: number
    unit_cost: number
    total_cost: number
    idempotency_key: string
    allocation_type: "sale"
  }>
  lot_decrements: Array<{ lot_id: string; new_remaining_quantity: number }>
  total_cost: number
  error: string | null
}

/** order_item başına idempotency_key → aynı item iki kez yazılmaz. */
export function planFifoConsumption(
  lots: CostLot[],
  quantity: number,
  orderItemKey: string
): FifoConsumptionPlan {
  const alloc = allocateFifo(lots, quantity)
  if (!alloc.ok) {
    return { ok: false, allocations: [], lot_decrements: [], total_cost: 0, error: alloc.error }
  }
  const remainingByLot = new Map(lots.map((l) => [l.lot_id, l.remaining_quantity]))
  const decrements = alloc.lines.map((l) => ({
    lot_id: l.lot_id,
    new_remaining_quantity: round2((remainingByLot.get(l.lot_id) ?? 0) - l.allocated_quantity),
  }))
  return {
    ok: true,
    allocations: alloc.lines.map((l) => ({
      lot_id: l.lot_id,
      allocated_quantity: l.allocated_quantity,
      unit_cost: l.unit_cost,
      total_cost: l.total_cost,
      idempotency_key: `${orderItemKey}:${l.lot_id}`,
      allocation_type: "sale" as const,
    })),
    lot_decrements: decrements,
    total_cost: alloc.total_cost,
    error: null,
  }
}

// ── Reversal planı (iptal/iade/return) ───────────────────────────────────────

export interface ReversalPlan {
  ok: boolean
  reversal_rows: Array<{ lot_id: string; quantity: number; unit_cost: number; allocation_type: "reversal"; idempotency_key: string }>
  lot_restorations: Array<{ lot_id: string; add_quantity: number }>
  error: string | null
}

export function planReversal(
  allocations: Array<{ lot_id: string; allocated_quantity: number; unit_cost: number; idempotency_key: string }>,
  alreadyReversed: boolean
): ReversalPlan {
  const rev = reverseAllocation(
    allocations.map((a) => ({ lot_id: a.lot_id, allocated_quantity: a.allocated_quantity, unit_cost: a.unit_cost, total_cost: round2(a.allocated_quantity * a.unit_cost) })),
    alreadyReversed
  )
  if (!rev.ok || alreadyReversed) {
    return { ok: rev.ok, reversal_rows: [], lot_restorations: [], error: rev.error }
  }
  return {
    ok: true,
    reversal_rows: rev.restored.map((r, i) => ({
      lot_id: r.lot_id,
      quantity: r.quantity,
      unit_cost: r.unit_cost,
      allocation_type: "reversal" as const,
      idempotency_key: `rev:${allocations[i]?.idempotency_key ?? r.lot_id}`,
    })),
    lot_restorations: rev.restored.map((r) => ({ lot_id: r.lot_id, add_quantity: r.quantity })),
    error: null,
  }
}
