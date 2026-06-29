import { model } from "@medusajs/framework/utils"

/** Talep tahmini anlık görüntüsü (geçmiş silinmez; dönem başına tekil). */
export const DemandForecastSnapshot = model.define("demand_forecast_snapshot", {
  id: model.id({ prefix: "dfc" }).primaryKey(),
  variant_id: model.text(),
  forecast_date: model.dateTime(),
  horizon_days: model.number(),
  predicted_demand: model.number(),
  lower_bound: model.number().default(0),
  upper_bound: model.number().default(0),
  confidence_score: model.number().default(0),
  model_version: model.text(),
  input_data_until: model.dateTime().nullable(),
})

/** Varyant/tedarikçi stok planlama politikası. */
export const InventoryPlanningPolicy = model.define("inventory_planning_policy", {
  id: model.id({ prefix: "iplan" }).primaryKey(),
  variant_id: model.text().unique(),
  supplier_id: model.text().nullable(),
  lead_time_days: model.number().default(14),
  safety_stock_days: model.number().default(7),
  target_cover_days: model.number().default(30),
  minimum_order_quantity: model.number().default(0),
  order_multiple: model.number().default(1),
  maximum_stock_days: model.number().default(120),
  service_level: model.number().default(0.9),
  manual_monthly_demand: model.number().nullable(),
  manual_override: model.boolean().default(false),
  auto_recommendation_enabled: model.boolean().default(true),
})

/** Yeniden sipariş önerisi (taslak; gerçek PO oluşturmaz). */
export const ReorderRecommendation = model.define("reorder_recommendation", {
  id: model.id({ prefix: "rord" }).primaryKey(),
  variant_id: model.text(),
  current_available_stock: model.number().default(0),
  reserved_stock: model.number().default(0),
  inbound_stock: model.number().default(0),
  forecast_demand: model.number().default(0),
  safety_stock: model.number().default(0),
  reorder_point: model.number().default(0),
  recommended_quantity: model.number().default(0),
  recommended_order_date: model.dateTime().nullable(),
  estimated_stockout_date: model.dateTime().nullable(),
  confidence_score: model.number().default(0),
  reason_codes: model.array(),
  estimated_purchase_budget: model.bigNumber().default(0),
  // draft | approved | rejected
  status: model.text().default("draft"),
  approved_by: model.text().nullable(),
  approved_at: model.dateTime().nullable(),
})

/** Tahmin doğruluğu (öğrenme döngüsü). */
export const ForecastAccuracy = model.define("forecast_accuracy", {
  id: model.id({ prefix: "facc" }).primaryKey(),
  variant_id: model.text(),
  forecast_snapshot_id: model.text().nullable(),
  predicted_quantity: model.number().default(0),
  actual_quantity: model.number().default(0),
  absolute_error: model.number().default(0),
  percentage_error: model.number().nullable(),
  bias: model.number().default(0),
  evaluated_at: model.dateTime(),
})
