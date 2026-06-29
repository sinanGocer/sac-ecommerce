import { MedusaService } from "@medusajs/framework/utils"

import CostAdjustment from "./models/cost-adjustment"
import CostAllocation from "./models/cost-allocation"
import InventoryCostLot from "./models/inventory-cost-lot"
import ProductPricingPolicy from "./models/product-pricing-policy"
import PurchaseReceipt from "./models/purchase-receipt"
import {
  DemandForecastSnapshot,
  ForecastAccuracy,
  InventoryPlanningPolicy,
  ReorderRecommendation,
} from "./models/forecasting"

/**
 * Lot Costing modül servisi. MedusaService modeller için otomatik CRUD üretir.
 *
 * Bu adımda: model + servis + modül kaydı + migration DOSYASI (çalıştırılmaz).
 * BİLEREK YAPILMADI (sonraki onaylı adımlar): migration'ı çalıştırma, stok-giriş
 * workflow'u, order→FIFO allocation subscriber'ı, Admin API/UI, job/scheduler.
 * Hesaplama mantığı `src/inventory-costing/` altında SAF + testlidir.
 */
class LotCostingService extends MedusaService({
  PurchaseReceipt,
  InventoryCostLot,
  CostAllocation,
  CostAdjustment,
  ProductPricingPolicy,
  DemandForecastSnapshot,
  InventoryPlanningPolicy,
  ReorderRecommendation,
  ForecastAccuracy,
}) {}

export default LotCostingService
