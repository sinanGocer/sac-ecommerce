/**
 * FIFO uygulama IO'su — sipariş için lot tüketimi + CostAllocation yazımı ve
 * reversal. SAF değil (servis/sorgu kullanır) ama mantık `write-ops` (testli)
 * planlarına dayanır. Idempotent: aynı order_item:lot tekrar yazılmaz; reversal
 * duplicate no-op. Oversell fail-closed (allocation yazılmaz).
 *
 * GERÇEK çağrı yalnız feature-flag'li yollardan yapılır (subscriber/API). Bu
 * fazda flag varsayılan KAPALI.
 */

import { CostLot } from "./inventory-costing-types"
import { planFifoConsumption, planReversal } from "./write-ops"

type AnyService = {
  listInventoryCostLots: (f: unknown, c?: unknown) => Promise<any[]>
  updateInventoryCostLots: (data: unknown) => Promise<unknown>
  listCostAllocations: (f: unknown, c?: unknown) => Promise<any[]>
  createCostAllocations: (data: unknown) => Promise<unknown>
}

type QueryGraph = { graph: (a: unknown, o?: unknown) => Promise<{ data?: unknown[] }> }
type Logger = { info: (m: string) => void; warn: (m: string) => void }

function toCostLots(rows: any[]): CostLot[] {
  return rows.map((l) => ({
    lot_id: String(l.id),
    received_at: String(l.received_at ?? l.created_at),
    remaining_quantity: Number(l.remaining_quantity ?? 0),
    effective_unit_cost: Number(l.effective_unit_cost ?? 0),
    status: (l.status as CostLot["status"]) ?? "active",
  }))
}

export interface ApplyResult {
  order_id: string
  applied_items: number
  written_allocations: number
  skipped_idempotent: number
  shortfalls: number
}

/** Sipariş için FIFO tüketimi uygular (idempotent, oversell fail-closed). */
export async function applyFifoForOrder(
  service: AnyService,
  query: QueryGraph,
  orderId: string,
  logger: Logger
): Promise<ApplyResult> {
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "canceled_at", "metadata", "items.id", "items.variant_id", "items.quantity"],
    filters: { id: orderId },
  })
  const order = (orders ?? [])[0] as
    | { canceled_at?: string | null; metadata?: Record<string, unknown>; items?: Array<{ id: string; variant_id: string; quantity: number }> }
    | undefined

  const result: ApplyResult = { order_id: orderId, applied_items: 0, written_allocations: 0, skipped_idempotent: 0, shortfalls: 0 }
  if (!order || order.canceled_at || (order.metadata ?? {})?.test_order === true) return result

  for (const item of order.items ?? []) {
    const orderItemKey = `${orderId}:${item.id}`
    // Idempotency: bu order_item için allocation zaten varsa atla.
    const existing = await service.listCostAllocations({ order_item_id: [item.id], allocation_type: ["sale"] }, { take: 1 }).catch(() => [])
    if (existing.length > 0) { result.skipped_idempotent++; continue }

    const lots = toCostLots(await service.listInventoryCostLots({ variant_id: [item.variant_id], status: ["active"] }, { take: 500 }).catch(() => []))
    const plan = planFifoConsumption(lots, item.quantity, orderItemKey)
    if (!plan.ok) {
      result.shortfalls++
      logger.warn(`[lot-costing] FIFO shortfall (oversell) order=${orderId} item=${item.id} — allocation yazılmadı.`)
      continue
    }
    // Allocation yaz + lot remaining azalt.
    await service.createCostAllocations(
      plan.allocations.map((a) => ({
        order_id: orderId,
        order_item_id: item.id,
        line_item_id: item.id,
        variant_id: item.variant_id,
        lot_id: a.lot_id,
        allocated_quantity: a.allocated_quantity,
        unit_cost: a.unit_cost,
        total_cost: a.total_cost,
        allocation_type: a.allocation_type,
        idempotency_key: a.idempotency_key,
        allocated_at: new Date().toISOString(),
      }))
    )
    for (const dec of plan.lot_decrements) {
      await service.updateInventoryCostLots({ id: dec.lot_id, remaining_quantity: dec.new_remaining_quantity })
    }
    result.applied_items++
    result.written_allocations += plan.allocations.length
  }
  return result
}

export interface ReverseResult {
  order_id: string
  reversed_items: number
  restored_quantity: number
  skipped_already_reversed: number
}

/** İptal/iade: allocation'ları ters kayıtla geri yükler (silmez, duplicate no-op). */
export async function reverseFifoForOrder(
  service: AnyService,
  orderId: string
): Promise<ReverseResult> {
  const result: ReverseResult = { order_id: orderId, reversed_items: 0, restored_quantity: 0, skipped_already_reversed: 0 }
  const sales = (await service.listCostAllocations({ order_id: [orderId], allocation_type: ["sale"] }, { take: 1000 }).catch(() => [])) as any[]
  if (sales.length === 0) return result

  // Zaten reversal var mı?
  const reversals = (await service.listCostAllocations({ order_id: [orderId], allocation_type: ["reversal"] }, { take: 1 }).catch(() => [])) as any[]
  const alreadyReversed = reversals.length > 0

  const plan = planReversal(
    sales.map((a) => ({ lot_id: String(a.lot_id), allocated_quantity: Number(a.allocated_quantity), unit_cost: Number(a.unit_cost), idempotency_key: String(a.idempotency_key) })),
    alreadyReversed
  )
  if (!plan.ok || alreadyReversed) {
    result.skipped_already_reversed = alreadyReversed ? 1 : 0
    return result
  }

  await service.createCostAllocations(
    plan.reversal_rows.map((r) => ({
      order_id: orderId,
      lot_id: r.lot_id,
      allocated_quantity: r.quantity,
      unit_cost: r.unit_cost,
      total_cost: Math.round(r.quantity * r.unit_cost * 100) / 100,
      allocation_type: r.allocation_type,
      idempotency_key: r.idempotency_key,
      allocated_at: new Date().toISOString(),
      reversed_at: new Date().toISOString(),
    }))
  )
  // Lot remaining geri ekle.
  const restoreByLot = new Map<string, number>()
  for (const r of plan.lot_restorations) restoreByLot.set(r.lot_id, (restoreByLot.get(r.lot_id) ?? 0) + r.add_quantity)
  for (const [lotId, add] of restoreByLot) {
    const cur = (await service.listInventoryCostLots({ id: [lotId] }, { take: 1 }).catch(() => []))[0] as { remaining_quantity?: number } | undefined
    const newQty = Number(cur?.remaining_quantity ?? 0) + add
    await service.updateInventoryCostLots({ id: lotId, remaining_quantity: newQty })
    result.restored_quantity += add
  }
  result.reversed_items = sales.length
  return result
}
