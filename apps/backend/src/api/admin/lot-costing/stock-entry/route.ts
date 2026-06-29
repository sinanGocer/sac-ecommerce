import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { viewerRoleFromKeys } from "../../../../inventory-costing/redaction"
import { planStockEntry, StockEntryFull } from "../../../../inventory-costing/write-ops"
import { resolveRoleKeys } from "../../../../rbac/catalog-editor"
import { createStockEntryWorkflow } from "../../../../workflows/lot-costing/create-stock-entry"

/**
 * POST /admin/lot-costing/stock-entry — owner/admin, ATOMİK stok girişi.
 *
 * GÜVENLİK: `LOT_COSTING_WRITE_ENABLED=true` olmadan 503 (varsayılan KAPALI →
 * gerçek sistemde stok girişi yapılmaz; yalnız test/fixture'ta açılır).
 * catalog_editor → 403.
 *
 * Yazım `createStockEntryWorkflow` ile yapılır: receipt + lot + inventory artışı
 * + audit TEK workflow'da, her adım compensation'lı. Idempotency_key zaten varsa
 * yeni kayıt/stok artışı YOK (no-op). Herhangi bir adım hata verirse önceki
 * adımlar geri alınır (yarım kayıt bırakılmaz).
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
  const entry: StockEntryFull = {
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
  }
  // Erken (anlaşılır) doğrulama; workflow da plan adımında tekrar doğrular.
  const plan = planStockEntry(entry)
  if (!plan.ok || !plan.lot || !plan.receipt) {
    res.status(400).json({ message: "validation_failed", errors: plan.errors })
    return
  }

  try {
    const { result } = await createStockEntryWorkflow(req.scope).run({
      input: { entry, actor_id: "owner" },
    })
    if (!result) {
      res.status(200).json({ idempotent_noop: true })
      return
    }
    res.status(201).json({
      lot_id: result.lot_id,
      receipt_id: result.receipt_id,
      effective_unit_cost: plan.effective_unit_cost,
      audit: result.audit,
    })
  } catch (e) {
    // Compensation tüm kısmi yazımları geri alır; güvenli/anlaşılır mesaj.
    res.status(422).json({ message: "stock_entry_failed_rolled_back", detail: e instanceof Error ? e.message : "unknown" })
  }
}