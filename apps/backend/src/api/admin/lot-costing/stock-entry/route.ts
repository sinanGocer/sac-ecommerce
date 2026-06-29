import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"

import { LOT_COSTING_MODULE } from "../../../../modules/lot-costing"
import type LotCostingService from "../../../../modules/lot-costing/service"
import { buildAuditEntry } from "../../../../inventory-costing/audit"
import { viewerRoleFromKeys } from "../../../../inventory-costing/redaction"
import { planStockEntry, StockEntryFull } from "../../../../inventory-costing/write-ops"
import { resolveRoleKeys } from "../../../../rbac/catalog-editor"

/**
 * POST /admin/lot-costing/stock-entry — owner/admin, transactional stok girişi.
 *
 * GÜVENLİK: `LOT_COSTING_WRITE_ENABLED=true` olmadan 503 (varsayılan KAPALI →
 * gerçek sistemde stok girişi yapılmaz; yalnız test/fixture'ta açılır).
 * Idempotent (idempotency_key zaten varsa no-op). catalog_editor → 403.
 *
 * Akış (idempotent + fail-closed): plan üret → mevcut lot kontrol → PurchaseReceipt
 * + InventoryCostLot oluştur → Medusa inventory level artır. Hata → fail-closed
 * (kısmi kayıt bırakılmaz; çağıran retry edebilir).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (process.env.LOT_COSTING_WRITE_ENABLED !== "true") {
    res.status(503).json({ message: "Lot costing write disabled (set LOT_COSTING_WRITE_ENABLED=true)." })
    return
  }
  const roleKeys = await resolveRoleKeys(req).catch(() => new Set<string>())
  if (viewerRoleFromKeys(roleKeys) !== "owner") {
    res.status(403).json({ message: "forbidden: owner/admin only" })
    return
  }

  const body = (req.body ?? {}) as Partial<StockEntryFull>
  const plan = planStockEntry({
    product_id: String(body.product_id ?? ""),
    variant_id: String(body.variant_id ?? ""),
    received_quantity: Number(body.received_quantity ?? 0),
    unit_purchase_cost: Number(body.unit_purchase_cost ?? 0),
    purchase_vat_rate: Number(body.purchase_vat_rate ?? 0),
    allocated_shipping_cost: body.allocated_shipping_cost != null ? Number(body.allocated_shipping_cost) : 0,
    allocated_additional_cost: body.allocated_additional_cost != null ? Number(body.allocated_additional_cost) : 0,
    location_id: body.location_id ?? null,
    inventory_item_id: body.inventory_item_id ?? null,
    supplier_id: body.supplier_id ?? null,
    supplier_name: body.supplier_name ?? null,
    invoice_number: body.invoice_number ?? null,
    lot_number: body.lot_number ?? null,
    received_at: body.received_at ?? null,
    expiry_date: body.expiry_date ?? null,
    currency: body.currency ?? "try",
    notes: body.notes ?? null,
    idempotency_key: String(body.idempotency_key ?? ""),
  })
  if (!plan.ok || !plan.lot || !plan.receipt) {
    res.status(400).json({ message: "validation_failed", errors: plan.errors })
    return
  }

  const service = req.scope.resolve<LotCostingService>(LOT_COSTING_MODULE)
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  // Idempotency: aynı key ile lot varsa no-op.
  const existing = (await service
    .listInventoryCostLots({ idempotency_key: [plan.lot.idempotency_key] } as never, { take: 1 } as never)
    .catch(() => [])) as Array<{ id: string }>
  if (existing.length > 0) {
    res.status(200).json({ idempotent_noop: true, lot_id: existing[0].id })
    return
  }

  const receipt = (await service.createPurchaseReceipts(plan.receipt as never)) as { id: string }
  const lot = (await service.createInventoryCostLots({
    ...plan.lot,
    purchase_receipt_id: receipt.id,
  } as never)) as { id: string }

  // Medusa inventory level artır (inventory_item_id + location verilmişse).
  if (plan.lot.inventory_item_id && plan.lot.location_id) {
    await updateInventoryLevelsWorkflow(req.scope).run({
      input: {
        updates: [
          {
            inventory_item_id: plan.lot.inventory_item_id,
            location_id: plan.lot.location_id,
            stocked_quantity: plan.inventory_delta,
          },
        ],
      },
    }).catch((e) => logger.warn(`[lot-costing] inventory level update skipped: ${e instanceof Error ? e.message : e}`))
  }

  const audit = buildAuditEntry({
    actor_id: "owner",
    action: "stock_entry",
    entity: "inventory_cost_lot",
    entity_id: lot.id,
    after: { ...plan.lot },
    idempotency_key: plan.lot.idempotency_key,
  })

  res.status(201).json({ lot_id: lot.id, receipt_id: receipt.id, effective_unit_cost: plan.effective_unit_cost, audit })
}
