import { model } from "@medusajs/framework/utils"

/** Tedarikçi alış faturası/irsaliyesi (lot'ların kaynağı). Hard delete yok. */
const PurchaseReceipt = model.define("purchase_receipt", {
  id: model.id({ prefix: "prcpt" }).primaryKey(),
  supplier_id: model.text().nullable(),
  supplier_name: model.text().nullable(),
  invoice_number: model.text().nullable(),
  receipt_date: model.dateTime(),
  currency: model.text().default("try"),
  total_shipping_cost: model.bigNumber().default(0),
  total_additional_cost: model.bigNumber().default(0),
  notes: model.text().nullable(),
  created_by: model.text().nullable(),
})

export default PurchaseReceipt
