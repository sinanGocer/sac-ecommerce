import { model } from "@medusajs/framework/utils"

/** Ürün/varyant fiyatlandırma politikası (tavsiye fiyat hesabı girdileri). */
const ProductPricingPolicy = model.define("lot_product_pricing_policy", {
  id: model.id({ prefix: "ppol" }).primaryKey(),
  product_id: model.text().nullable(),
  variant_id: model.text().unique(),
  sales_vat_rate: model.number().default(0.2),
  payment_fee_rate: model.number().default(0),
  platform_fee_rate: model.number().default(0),
  packaging_cost: model.bigNumber().default(0),
  shipping_contribution: model.bigNumber().default(0),
  operational_cost: model.bigNumber().default(0),
  minimum_profit_amount: model.bigNumber().default(0),
  minimum_margin_rate: model.number().default(0),
  target_margin_rate: model.number().default(0),
  maximum_discount_rate: model.number().default(0),
  // none | whole | charm_90 | charm_99
  rounding_strategy: model.text().default("none"),
  rounding_step: model.number().default(0),
  currency: model.text().default("try"),
  updated_by: model.text().nullable(),
})

export default ProductPricingPolicy
