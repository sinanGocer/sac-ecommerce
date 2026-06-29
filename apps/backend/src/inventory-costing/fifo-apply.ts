/**
 * FIFO uygulama orchestrator'ı — siparişi okur, her order_item için
 * CONCURRENCY-GÜVENLİ atomik tüketimi servise devreder.
 *
 * Gerçek lot tüketimi `LotCostingService.consumeFifoForItem` içinde MikroORM
 * transaction + PESSIMISTIC_WRITE satır kilidiyle yapılır (oversell imkânsız,
 * idempotent, aktivasyon guard'lı). Reversal de aynı şekilde atomik.
 *
 * GERÇEK çağrı yalnız feature-flag'li yollardan (subscriber) yapılır; flag
 * varsayılan KAPALI.
 */

import type {
  ConsumeItemResult,
  ReverseResult as TxReverseResult,
} from "./fifo-tx"

type FifoService = {
  consumeFifoForItem: (
    input: { order_id: string; order_item_id: string; variant_id: string; product_id: string; quantity: number },
    logger: { info: (m: string) => void; warn: (m: string) => void }
  ) => Promise<ConsumeItemResult>
  reverseFifoForOrder: (
    input: { order_id: string },
    logger: { info: (m: string) => void; warn: (m: string) => void }
  ) => Promise<TxReverseResult>
}

type QueryGraph = { graph: (a: unknown, o?: unknown) => Promise<{ data?: unknown[] }> }
type Logger = { info: (m: string) => void; warn: (m: string) => void }

export interface ApplyResult {
  order_id: string
  applied_items: number
  written_allocations: number
  skipped_idempotent: number
  shortfalls: number
  blocked_unvalued: number
}

/** Sipariş için FIFO tüketimi (atomik/kilitli, idempotent, oversell fail-closed). */
export async function applyFifoForOrder(
  service: FifoService,
  query: QueryGraph,
  orderId: string,
  logger: Logger
): Promise<ApplyResult> {
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "canceled_at", "metadata", "items.id", "items.variant_id", "items.product_id", "items.quantity"],
    filters: { id: orderId },
  })
  const order = (orders ?? [])[0] as
    | {
        canceled_at?: string | null
        metadata?: Record<string, unknown>
        items?: Array<{ id: string; variant_id: string; product_id: string; quantity: number }>
      }
    | undefined

  const result: ApplyResult = {
    order_id: orderId,
    applied_items: 0,
    written_allocations: 0,
    skipped_idempotent: 0,
    shortfalls: 0,
    blocked_unvalued: 0,
  }
  if (!order || order.canceled_at || (order.metadata ?? {})?.test_order === true) return result

  for (const item of order.items ?? []) {
    const res = await service.consumeFifoForItem(
      {
        order_id: orderId,
        order_item_id: item.id,
        variant_id: item.variant_id,
        product_id: item.product_id,
        quantity: item.quantity,
      },
      logger
    )
    switch (res.status) {
      case "applied":
        result.applied_items++
        result.written_allocations += res.written_allocations
        break
      case "skipped_idempotent":
        result.skipped_idempotent++
        break
      case "shortfall":
        result.shortfalls++
        // engine zaten warn logladı (oversell engellendi, allocation yazılmadı).
        break
      case "blocked_unvalued":
        result.blocked_unvalued++
        logger.warn(
          `[lot-costing] AKTİVASYON GUARD: variant=${item.variant_id} değerlenmemiş açılış stoğu (UNVALUED_OPENING_STOCK) — FIFO başlatılmadı. Operatör: önce tüm açılış stoğunu lotlara bağlayın. order=${orderId} item=${item.id}`
        )
        break
    }
  }
  return result
}

export interface ReverseResult {
  order_id: string
  reversed_items: number
  restored_quantity: number
  skipped_already_reversed: number
}

/** İptal/iade: allocation'ları ters kayıtla geri yükler (atomik/kilitli, duplicate no-op). */
export async function reverseFifoForOrder(
  service: FifoService,
  orderId: string,
  logger: Logger = { info: () => {}, warn: () => {} }
): Promise<ReverseResult> {
  const res = await service.reverseFifoForOrder({ order_id: orderId }, logger)
  return {
    order_id: orderId,
    reversed_items: res.reversed_rows,
    restored_quantity: res.restored_quantity,
    skipped_already_reversed: res.status === "noop_already_reversed" ? 1 : 0,
  }
}
