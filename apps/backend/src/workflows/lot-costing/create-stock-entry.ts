import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  when,
} from "@medusajs/framework/workflows-sdk"
import { updateInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"

import { LOT_COSTING_MODULE } from "../../modules/lot-costing"
import type LotCostingService from "../../modules/lot-costing/service"
import { buildAuditEntry } from "../../inventory-costing/audit"
import { planStockEntry, StockEntryFull } from "../../inventory-costing/write-ops"

/**
 * Atomik stok girişi (Medusa workflow + compensation).
 *
 * Adımlar (her biri compensation'lı; hata → ters sırada geri alınır):
 *  1) idempotency kontrol (yeni yazım yok → no-op)
 *  2) PurchaseReceipt oluştur   (comp: soft-delete receipt)
 *  3) InventoryCostLot oluştur  (comp: soft-delete lot)
 *  4) Medusa inventory level artır (updateInventoryLevelsWorkflow.runAsStep —
 *     kendi compensation'ı seviyeyi eski değerine döndürür)
 *  5) audit YALNIZ başarılı commit sonrasında üretilir
 *
 * Hard delete yok (MedusaService.delete = soft delete / deleted_at). Yarım kayıt
 * bırakılmaz: herhangi bir adım hata verirse önceki adımlar compensate edilir.
 */

type CheckInput = { idempotency_key: string }
const checkIdempotencyStep = createStep(
  "lot-costing-check-idempotency",
  async (input: CheckInput, { container }) => {
    const svc = container.resolve<LotCostingService>(LOT_COSTING_MODULE)
    const existing = (await svc.listInventoryCostLots(
      { idempotency_key: [input.idempotency_key] } as never,
      { take: 1 } as never
    )) as Array<{ id: string }>
    return new StepResponse({ exists: existing.length > 0, lot_id: existing[0]?.id ?? null })
  }
)

const createReceiptStep = createStep(
  "lot-costing-create-receipt",
  async (receipt: Record<string, unknown>, { container }) => {
    const svc = container.resolve<LotCostingService>(LOT_COSTING_MODULE)
    const created = (await svc.createPurchaseReceipts(receipt as never)) as { id: string }
    return new StepResponse(created, created.id)
  },
  async (receiptId, { container }) => {
    if (!receiptId) return
    const svc = container.resolve<LotCostingService>(LOT_COSTING_MODULE)
    await svc.deletePurchaseReceipts([receiptId]) // soft delete (compensation)
  }
)

const createLotStep = createStep(
  "lot-costing-create-lot",
  async (lot: Record<string, unknown>, { container }) => {
    const svc = container.resolve<LotCostingService>(LOT_COSTING_MODULE)
    const created = (await svc.createInventoryCostLots(lot as never)) as { id: string }
    return new StepResponse(created, created.id)
  },
  async (lotId, { container }) => {
    if (!lotId) return
    const svc = container.resolve<LotCostingService>(LOT_COSTING_MODULE)
    await svc.deleteInventoryCostLots([lotId]) // soft delete (compensation)
  }
)

type AuditInput = { actor_id: string; lot_id: string; lot: Record<string, unknown>; idempotency_key: string }
const recordAuditStep = createStep(
  "lot-costing-audit",
  async (input: AuditInput) => {
    // Audit yalnız başarılı commit sonrası bu adımda üretilir.
    const audit = buildAuditEntry({
      actor_id: input.actor_id,
      action: "stock_entry",
      entity: "inventory_cost_lot",
      entity_id: input.lot_id,
      after: input.lot,
      idempotency_key: input.idempotency_key,
    })
    return new StepResponse(audit)
  }
)

export interface CreateStockEntryWorkflowInput {
  entry: StockEntryFull & { location_id?: string | null; inventory_item_id?: string | null }
  actor_id: string
}

// ── Yardımcı saf adımlar (workflow-sdk transform yerine basit step'ler) ──────

const planStockEntryStep = createStep(
  "lot-costing-plan",
  async (entry: StockEntryFull) => {
    const plan = planStockEntry(entry)
    if (!plan.ok || !plan.lot || !plan.receipt) {
      throw new Error(`[lot-costing] validation_failed: ${plan.errors.join(",")}`)
    }
    return new StepResponse({ receipt: plan.receipt, lot: plan.lot, inventory_delta: plan.inventory_delta })
  }
)

const transformLotInput = createStep(
  "lot-costing-bind-receipt",
  async (input: { plan: { lot: Record<string, unknown> }; receipt: { id: string } }) => {
    return new StepResponse({ ...input.plan.lot, purchase_receipt_id: input.receipt.id })
  }
)

type InventoryCompensation = {
  lot: { inventory_item_id?: string | null; location_id?: string | null }
  previous: number
} | null

const maybeIncreaseInventory = createStep(
  "lot-costing-increase-inventory",
  async (
    input: { plan: { lot: Record<string, unknown>; inventory_delta: number } },
    { container }
  ) => {
    const lot = input.plan.lot as { inventory_item_id?: string | null; location_id?: string | null }
    if (!lot.inventory_item_id || !lot.location_id) {
      return new StepResponse<{ adjusted: boolean; previous: number }, InventoryCompensation>(
        { adjusted: false, previous: 0 },
        null
      )
    }
    // Mevcut seviyeyi oku (compensation için).
    const query = container.resolve("query") as { graph: (a: unknown) => Promise<{ data?: unknown[] }> }
    let previous = 0
    try {
      const { data } = await query.graph({
        entity: "inventory_level",
        fields: ["stocked_quantity"],
        filters: { inventory_item_id: lot.inventory_item_id, location_id: lot.location_id },
      } as never)
      previous = Number((data?.[0] as { stocked_quantity?: number })?.stocked_quantity ?? 0)
    } catch {
      previous = 0
    }
    await updateInventoryLevelsWorkflow(container).run({
      input: {
        updates: [
          {
            inventory_item_id: lot.inventory_item_id,
            location_id: lot.location_id,
            stocked_quantity: previous + input.plan.inventory_delta,
          },
        ],
      },
    })
    return new StepResponse<{ adjusted: boolean; previous: number }, InventoryCompensation>(
      { adjusted: true, previous },
      { lot, previous }
    )
  },
  async (comp, { container }) => {
    if (!comp?.lot.inventory_item_id || !comp.lot.location_id) return
    // Compensation: seviyeyi eski değerine döndür.
    await updateInventoryLevelsWorkflow(container).run({
      input: {
        updates: [
          {
            inventory_item_id: comp.lot.inventory_item_id,
            location_id: comp.lot.location_id,
            stocked_quantity: comp.previous,
          },
        ],
      },
    })
  }
)

export const createStockEntryWorkflow = createWorkflow(
  "lot-costing-create-stock-entry",
  (input: CreateStockEntryWorkflowInput) => {
    const idem = checkIdempotencyStep({ idempotency_key: input.entry.idempotency_key })

    // Yalnız idempotency_key yoksa gerçek yazımları yap.
    const result = when({ idem, input }, (data) => !data.idem.exists).then(() => {
      const plan = planStockEntryStep(input.entry)
      const receipt = createReceiptStep(plan.receipt)
      const lot = createLotStep(
        // receipt id'sini lot'a bağla
        transformLotInput({ plan, receipt })
      )
      // Inventory level artışı (inventory_item_id + location varsa) — kendi compensation'lı.
      maybeIncreaseInventory({ plan })
      const audit = recordAuditStep({
        actor_id: input.actor_id,
        lot_id: lot.id,
        lot: plan.lot,
        idempotency_key: input.entry.idempotency_key,
      })
      return { lot_id: lot.id, receipt_id: receipt.id, audit, idempotent_noop: false }
    })

    return new WorkflowResponse(result)
  }
)
