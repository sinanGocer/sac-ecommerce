import { model } from "@medusajs/framework/utils"

/** Satışta hangi lottan ne kadar düşüldüğü + gerçek maliyet. Silinmez; iptal/iade ters kayıtla. */
const CostAllocation = model.define("cost_allocation", {
  id: model.id({ prefix: "calloc" }).primaryKey(),
  order_id: model.text().nullable(),
  order_item_id: model.text().nullable(),
  line_item_id: model.text().nullable(),
  product_id: model.text(),
  variant_id: model.text(),
  lot_id: model.text(),
  allocated_quantity: model.number(),
  unit_cost: model.bigNumber(),
  total_cost: model.bigNumber(),
  // sale | reversal
  allocation_type: model.text().default("sale"),
  idempotency_key: model.text().unique(),
  allocated_at: model.dateTime(),
  reversed_at: model.dateTime().nullable(),
})

export default CostAllocation
