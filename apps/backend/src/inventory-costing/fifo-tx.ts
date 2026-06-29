/**
 * FIFO transactional engine — DB seviyesinde concurrency-güvenli lot tüketimi ve
 * reversal. Hesaplama saf `write-ops` planlarına dayanır; burada YALNIZ kilitleme
 * + transaction + yazma yapılır.
 *
 * Güvenlik modeli (oversell ASLA olmaz):
 *  - `manager.transactional()` ile tek transaction.
 *  - Tüketilecek lotlar PESSIMISTIC_WRITE (SELECT ... FOR UPDATE) ile kilitlenir
 *    → eşzamanlı iki sipariş aynı lotları serialize eder.
 *  - Kalan miktar transaction İÇİNDEKİ güncel (kilitli) satırdan okunur.
 *  - Stok yetersizse hiçbir yazım yapılmadan throw → rollback.
 *  - cost_allocation.idempotency_key UNIQUE index → aynı order_item iki kez
 *    yazılamaz (race olsa bile ikinci insert reddedilir = idempotent no-op).
 *  - inventory_cost_lot CHECK (remaining>=0, remaining<=received) → son savunma.
 *
 * RAW SQL YOK, process-memory mutex YOK, check-then-update (kilitsiz) YOK.
 * Deadlock/serialization hatasında SINIRLI + loglanan retry (sessiz döngü değil).
 */

import { LockMode } from "@medusajs/deps/mikro-orm/core"

import { CostLot } from "./inventory-costing-types"
import { planFifoConsumption, planReversal } from "./write-ops"

// MikroORM SqlEntityManager (minimal yüzey — framework tipine bağımlı değil).
export interface TxManager {
  transactional<T>(cb: (tx: TxEntityManager) => Promise<T>): Promise<T>
}
export interface TxEntityManager {
  find<T = any>(entity: unknown, where: Record<string, unknown>, options?: Record<string, unknown>): Promise<T[]>
  create<T = any>(entity: unknown, data: Record<string, unknown>): T
  persist(entity: unknown): unknown
  flush(): Promise<void>
}

export interface FifoEntities {
  Lot: unknown
  Allocation: unknown
}

type Logger = { info: (m: string) => void; warn: (m: string) => void }

const RETRYABLE_PG_CODES = new Set(["40001", "40P01"]) // serialization_failure, deadlock_detected
const DEFAULT_MAX_ATTEMPTS = 3

export class FifoShortfallError extends Error {
  constructor(public readonly detail: string) {
    super(`fifo_shortfall:${detail}`)
    this.name = "FifoShortfallError"
  }
}

function pgErrorCode(e: unknown): string | undefined {
  const anyE = e as { code?: string; cause?: { code?: string } }
  return anyE?.code ?? anyE?.cause?.code
}

/** Yalnız deadlock/serialization hatalarında SINIRLI retry (loglanır, sessiz değil). */
async function withDeadlockRetry<T>(
  fn: () => Promise<T>,
  logger: Logger,
  label: string,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      const code = pgErrorCode(e)
      if (code && RETRYABLE_PG_CODES.has(code) && attempt < maxAttempts) {
        const backoff = 15 * attempt + Math.floor(Math.random() * 15)
        logger.warn(`[lot-costing] ${label} deadlock/serialization (${code}) attempt=${attempt}/${maxAttempts} — retry in ${backoff}ms`)
        await new Promise((r) => setTimeout(r, backoff))
        continue
      }
      throw e
    }
  }
  throw lastErr
}

function lotRowToCostLot(l: Record<string, any>): CostLot {
  return {
    lot_id: String(l.id),
    received_at: String(l.received_at instanceof Date ? l.received_at.toISOString() : (l.received_at ?? l.created_at)),
    remaining_quantity: Number(l.remaining_quantity ?? 0),
    effective_unit_cost: Number(l.effective_unit_cost ?? 0),
    status: (l.status as CostLot["status"]) ?? "active",
  }
}

export interface ConsumeItemInput {
  order_id: string
  order_item_id: string
  variant_id: string
  product_id: string
  quantity: number
}

export interface ConsumeItemResult {
  status: "applied" | "skipped_idempotent" | "shortfall" | "blocked_unvalued"
  written_allocations: number
  total_cost: number
}

/**
 * Tek order_item için FIFO tüketimi (atomik, kilitli). Idempotent: aynı order_item
 * tekrar gelirse no-op. Stok yetersizse rollback + shortfall (allocation yazılmaz).
 */
export async function consumeFifoForItemTx(
  manager: TxManager,
  entities: FifoEntities,
  input: ConsumeItemInput,
  logger: Logger
): Promise<ConsumeItemResult> {
  const orderItemKey = `${input.order_id}:${input.order_item_id}`

  try {
    return await withDeadlockRetry(
      () =>
        manager.transactional(async (tx) => {
          // 1) Idempotency: bu order_item için satış allocation zaten var mı?
          const existing = await tx.find(entities.Allocation, {
            order_item_id: input.order_item_id,
            allocation_type: "sale",
          }, { limit: 1 })
          if (existing.length > 0) {
            return { status: "skipped_idempotent" as const, written_allocations: 0, total_cost: 0 }
          }

          // 1b) AKTİVASYON GUARD: değerlenmemiş açılış stoğu varsa FIFO BAŞLATMA.
          // (UNVALUED_OPENING_STOCK). Kontrolsüz exception ÜRETME — güvenli no-op
          // + operatör uyarısı; satış siparişi bozulmaz.
          const unvalued = await tx.find(entities.Lot, {
            variant_id: input.variant_id,
            status: "unvalued_opening_stock",
          }, { limit: 1 })
          if (unvalued.length > 0) {
            return { status: "blocked_unvalued" as const, written_allocations: 0, total_cost: 0 }
          }

          // 2) Lotları received_at ASC sırasıyla KİLİTLE (FOR UPDATE).
          const lockedRows = await tx.find(entities.Lot, {
            variant_id: input.variant_id,
            status: "active",
          }, {
            orderBy: { received_at: "ASC", id: "ASC" },
            lockMode: LockMode.PESSIMISTIC_WRITE,
          })

          // 3) Kalan miktarları kilitli satırlardan oku → FIFO plan.
          const lots = lockedRows.map(lotRowToCostLot)
          const plan = planFifoConsumption(lots, input.quantity, orderItemKey)
          if (!plan.ok) {
            // 4) Stok yetersiz → throw → rollback (hiçbir yazım yok).
            throw new FifoShortfallError(`${plan.error ?? "insufficient"}:order=${input.order_id}:item=${input.order_item_id}`)
          }

          // 5) CostAllocation kayıtları (idempotency_key UNIQUE → DB race koruması).
          for (const a of plan.allocations) {
            tx.create(entities.Allocation, {
              order_id: input.order_id,
              order_item_id: input.order_item_id,
              line_item_id: input.order_item_id,
              product_id: input.product_id,
              variant_id: input.variant_id,
              lot_id: a.lot_id,
              allocated_quantity: a.allocated_quantity,
              unit_cost: a.unit_cost,
              total_cost: a.total_cost,
              allocation_type: "sale",
              reversed_quantity: 0,
              idempotency_key: a.idempotency_key,
              allocated_at: new Date(),
            })
          }

          // 6) Lot remaining_quantity azalt (kilitli satır üzerinde).
          const decByLot = new Map(plan.lot_decrements.map((d) => [d.lot_id, d.new_remaining_quantity]))
          for (const row of lockedRows as Array<Record<string, any>>) {
            const next = decByLot.get(String(row.id))
            if (next === undefined) continue
            row.remaining_quantity = next
            if (next <= 0) row.status = "depleted"
          }

          // 7) Tek commit (transactional dönüşünde flush).
          await tx.flush()
          return { status: "applied" as const, written_allocations: plan.allocations.length, total_cost: plan.total_cost }
        }),
      logger,
      `consume order=${input.order_id} item=${input.order_item_id}`
    )
  } catch (e) {
    if (e instanceof FifoShortfallError) {
      logger.warn(`[lot-costing] FIFO shortfall (oversell engellendi) ${e.detail} — allocation yazılmadı, rollback.`)
      return { status: "shortfall", written_allocations: 0, total_cost: 0 }
    }
    // Unique violation = eşzamanlı duplicate event → idempotent no-op.
    if (pgErrorCode(e) === "23505") {
      logger.warn(`[lot-costing] FIFO duplicate allocation (unique) order=${input.order_id} item=${input.order_item_id} — idempotent no-op.`)
      return { status: "skipped_idempotent", written_allocations: 0, total_cost: 0 }
    }
    throw e
  }
}

export interface ReverseInput {
  order_id: string
}
export interface ReverseResult {
  status: "reversed" | "noop_already_reversed" | "noop_no_sales"
  reversed_rows: number
  restored_quantity: number
}

/**
 * Sipariş iptali/iadesi → reversal (atomik, kilitli). Yalnız henüz reverse
 * EDİLMEMİŞ miktar geri eklenir (reversed_quantity izlenir). Lot received üstüne
 * çıkmaz. Duplicate reversal no-op. Reversal kaydı immutable (silinmez).
 */
export async function reverseFifoForOrderTx(
  manager: TxManager,
  entities: FifoEntities,
  input: ReverseInput,
  logger: Logger
): Promise<ReverseResult> {
  try {
    return await reverseFifoForOrderTxInner(manager, entities, input, logger)
  } catch (e) {
    // Eşzamanlı duplicate reversal yarışı (lock + unique) → güvenli no-op.
    if (pgErrorCode(e) === "23505") {
      logger.warn(`[lot-costing] reversal duplicate (unique) order=${input.order_id} — idempotent no-op.`)
      return { status: "noop_already_reversed", reversed_rows: 0, restored_quantity: 0 }
    }
    throw e
  }
}

async function reverseFifoForOrderTxInner(
  manager: TxManager,
  entities: FifoEntities,
  input: ReverseInput,
  logger: Logger
): Promise<ReverseResult> {
  return withDeadlockRetry(
    () =>
      manager.transactional(async (tx) => {
        // 1) Satış allocation'larını KİLİTLE.
        const sales = (await tx.find(entities.Allocation, {
          order_id: input.order_id,
          allocation_type: "sale",
        }, { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: "ASC" } })) as Array<Record<string, any>>

        if (sales.length === 0) {
          return { status: "noop_no_sales" as const, reversed_rows: 0, restored_quantity: 0 }
        }

        // 2) Her satış için henüz reverse edilmemiş miktarı belirle.
        const pending = sales
          .map((s) => ({
            row: s,
            lot_id: String(s.lot_id),
            allocated: Number(s.allocated_quantity),
            already: Number(s.reversed_quantity ?? 0),
            unit_cost: Number(s.unit_cost),
            idempotency_key: String(s.idempotency_key),
          }))
          .map((s) => ({ ...s, newly: Math.max(0, s.allocated - s.already) }))

        const totalNewly = pending.reduce((acc, p) => acc + p.newly, 0)
        if (totalNewly <= 0) {
          return { status: "noop_already_reversed" as const, reversed_rows: 0, restored_quantity: 0 }
        }

        // 3) Reversal planı (saf) — yalnız newly>0 satırlar için.
        const toReverse = pending.filter((p) => p.newly > 0)
        const plan = planReversal(
          toReverse.map((p) => ({
            lot_id: p.lot_id,
            allocated_quantity: p.newly, // yalnız kalan reverse edilebilir miktar
            unit_cost: p.unit_cost,
            idempotency_key: `${p.idempotency_key}:rev:${p.already}+${p.newly}`,
          })),
          false
        )
        if (!plan.ok) {
          throw new Error(`reversal_plan_failed:${plan.error ?? "unknown"}`)
        }

        // 4) İlgili lotları KİLİTLE.
        const lotIds = Array.from(new Set(plan.lot_restorations.map((r) => r.lot_id)))
        const lots = (await tx.find(entities.Lot, { id: lotIds }, {
          lockMode: LockMode.PESSIMISTIC_WRITE,
          orderBy: { id: "ASC" },
        })) as Array<Record<string, any>>
        const lotById = new Map(lots.map((l) => [String(l.id), l]))

        // 5) Lot remaining geri ekle — received_quantity ÜSTÜNE ÇIKMA.
        const restoreByLot = new Map<string, number>()
        for (const r of plan.lot_restorations) {
          restoreByLot.set(r.lot_id, (restoreByLot.get(r.lot_id) ?? 0) + r.add_quantity)
        }
        let restored = 0
        for (const [lotId, add] of restoreByLot) {
          const lot = lotById.get(lotId)
          if (!lot) throw new Error(`reversal_lot_missing:${lotId}`)
          const received = Number(lot.received_quantity)
          const capped = Math.min(Number(lot.remaining_quantity) + add, received)
          const effective = capped - Number(lot.remaining_quantity)
          lot.remaining_quantity = capped
          if (capped > 0 && lot.status === "depleted") lot.status = "active"
          restored += effective
        }

        // 6) reversed_quantity güncelle (kısmi iade güvenliği).
        for (const p of toReverse) {
          p.row.reversed_quantity = p.already + p.newly
          p.row.reversed_at = new Date()
        }

        // 7) Immutable reversal kayıtları yaz (audit; silinmez).
        for (const r of plan.reversal_rows) {
          tx.create(entities.Allocation, {
            order_id: input.order_id,
            product_id: String((sales[0] as Record<string, any>).product_id),
            variant_id: String((sales[0] as Record<string, any>).variant_id),
            lot_id: r.lot_id,
            allocated_quantity: r.quantity,
            unit_cost: r.unit_cost,
            total_cost: Math.round(r.quantity * r.unit_cost * 100) / 100,
            allocation_type: "reversal",
            reversed_quantity: 0,
            idempotency_key: r.idempotency_key,
            allocated_at: new Date(),
            reversed_at: new Date(),
          })
        }

        await tx.flush()
        return { status: "reversed" as const, reversed_rows: plan.reversal_rows.length, restored_quantity: restored }
      }),
    logger,
    `reverse order=${input.order_id}`
  )
}
