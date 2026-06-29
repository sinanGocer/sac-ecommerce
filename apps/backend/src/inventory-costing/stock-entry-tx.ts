/**
 * Atomik stok girişi — DB transaction tabanlı (receipt + lot TEK transaction).
 *
 * Production stok girişi Medusa workflow saga'sı (`createStockEntryWorkflow`,
 * compensation'lı) ile yapılır; bu modül AYNI atomiklik garantisini DB
 * transaction seviyesinde sağlar ve izole entegrasyon testlerinde gerçek
 * PostgreSQL'e karşı doğrulanabilir kılar:
 *
 *   - idempotency_key zaten varsa → no-op (yeni receipt/lot yok)
 *   - receipt + lot tek transaction → herhangi bir adım hata verirse İKİSİ de
 *     yazılmaz (yarım kayıt imkânsız = compensation eşdeğeri)
 *   - "inventory increase" adımı dışarıdan enjekte edilebilir; hata verirse
 *     transaction rollback → receipt + lot geri alınır
 *   - audit YALNIZ başarılı commit sonrası üretilir (çağıran tarafından)
 */

import { TxManager } from "./fifo-tx"
import { planStockEntry, StockEntryFull } from "./write-ops"

export interface StockEntryEntities {
  Lot: unknown
  Receipt: unknown
}

type Logger = { info: (m: string) => void; warn: (m: string) => void }

export interface StockEntryTxResult {
  status: "created" | "skipped_idempotent" | "validation_failed"
  receipt_id: string | null
  lot_id: string | null
  errors: string[]
}

/**
 * inventory increase adımı: gerçek sistemde Medusa inventory level artışı.
 * Test/compensation için enjekte edilir; throw ederse tüm transaction rollback.
 */
export type InventoryIncreaseFn = (lotId: string, receiptId: string) => Promise<void>

export async function createStockEntryTx(
  manager: TxManager,
  entities: StockEntryEntities,
  entry: StockEntryFull,
  opts: { onInventoryIncrease?: InventoryIncreaseFn; idGen?: () => string } = {},
  logger?: Logger
): Promise<StockEntryTxResult> {
  const plan = planStockEntry(entry)
  if (!plan.ok || !plan.lot || !plan.receipt) {
    return { status: "validation_failed", receipt_id: null, lot_id: null, errors: plan.errors }
  }

  const genId = opts.idGen ?? (() => `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`)

  return manager.transactional(async (tx) => {
    // 1) Idempotency: aynı idempotency_key'li lot varsa no-op.
    const existing = await tx.find(entities.Lot, { idempotency_key: entry.idempotency_key }, { limit: 1 })
    if (existing.length > 0) {
      return { status: "skipped_idempotent" as const, receipt_id: null, lot_id: String((existing[0] as any).id), errors: [] }
    }

    // 2) Receipt (compensation: rollback hepsini geri alır).
    const receiptId = `receipt_${genId()}`
    tx.create(entities.Receipt, {
      id: receiptId,
      supplier_id: plan.receipt!.supplier_id,
      supplier_name: plan.receipt!.supplier_name,
      invoice_number: plan.receipt!.invoice_number,
      receipt_date: new Date(plan.receipt!.receipt_date),
      currency: plan.receipt!.currency,
      total_shipping_cost: plan.receipt!.total_shipping_cost,
      total_additional_cost: plan.receipt!.total_additional_cost,
      notes: plan.receipt!.notes,
    })

    // 3) Lot (receipt'e bağlı).
    const lotId = `lot_${genId()}`
    tx.create(entities.Lot, {
      id: lotId,
      purchase_receipt_id: receiptId,
      product_id: plan.lot!.product_id,
      variant_id: plan.lot!.variant_id,
      inventory_item_id: plan.lot!.inventory_item_id,
      location_id: plan.lot!.location_id,
      lot_number: plan.lot!.lot_number,
      received_quantity: plan.lot!.received_quantity,
      remaining_quantity: plan.lot!.remaining_quantity,
      reserved_quantity: 0,
      unit_purchase_cost: plan.lot!.unit_purchase_cost,
      purchase_vat_rate: plan.lot!.purchase_vat_rate,
      allocated_shipping_cost: plan.lot!.allocated_shipping_cost,
      allocated_additional_cost: plan.lot!.allocated_additional_cost,
      effective_unit_cost: plan.lot!.effective_unit_cost,
      received_at: new Date(plan.lot!.received_at),
      expiry_date: plan.lot!.expiry_date ? new Date(plan.lot!.expiry_date) : null,
      status: "active",
      idempotency_key: entry.idempotency_key,
    })

    // 4) Inventory increase (enjekte edilebilir). Hata → throw → rollback (lot+receipt).
    if (opts.onInventoryIncrease) {
      await opts.onInventoryIncrease(lotId, receiptId)
    }

    await tx.flush()
    logger?.info(`[lot-costing] stock-entry tx committed lot=${lotId} receipt=${receiptId}`)
    return { status: "created" as const, receipt_id: receiptId, lot_id: lotId, errors: [] }
  })
}
