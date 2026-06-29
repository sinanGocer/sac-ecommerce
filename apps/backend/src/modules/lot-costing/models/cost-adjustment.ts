import { model } from "@medusajs/framework/utils"

/** Lot maliyet/miktar düzeltmesi — yalnız ters kayıt/audit (geçmiş sessizce değişmez). */
const CostAdjustment = model.define("cost_adjustment", {
  id: model.id({ prefix: "cadj" }).primaryKey(),
  lot_id: model.text(),
  quantity_delta: model.number().default(0),
  old_cost: model.bigNumber().nullable(),
  new_cost: model.bigNumber().nullable(),
  reason: model.text().nullable(),
  actor_id: model.text().nullable(),
})

export default CostAdjustment
