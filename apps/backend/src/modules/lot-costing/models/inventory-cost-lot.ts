import { model } from "@medusajs/framework/utils"

/**
 * Parti (lot) bazlı stok maliyeti. Aynı ürün/varyant farklı tarih/maliyetle
 * ayrı lotlarda tutulur (tek maliyet altında birleştirilmez). remaining_quantity
 * received_quantity'yi aşamaz; FIFO tüketiminde azalır.
 */
const InventoryCostLot = model.define("inventory_cost_lot", {
  id: model.id({ prefix: "lot" }).primaryKey(),
  purchase_receipt_id: model.text().nullable(),
  product_id: model.text(),
  variant_id: model.text(),
  inventory_item_id: model.text().nullable(),
  location_id: model.text().nullable(),
  lot_number: model.text().nullable(),
  received_quantity: model.number(),
  remaining_quantity: model.number(),
  reserved_quantity: model.number().default(0),
  unit_purchase_cost: model.bigNumber(),
  purchase_vat_rate: model.number().default(0),
  allocated_shipping_cost: model.bigNumber().default(0),
  allocated_additional_cost: model.bigNumber().default(0),
  effective_unit_cost: model.bigNumber(),
  received_at: model.dateTime(),
  expiry_date: model.dateTime().nullable(),
  // active | depleted | unvalued_opening_stock | blocked
  status: model.text().default("active"),
  idempotency_key: model.text().unique(),
  created_by: model.text().nullable(),
})

export default InventoryCostLot
