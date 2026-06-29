import {
  InjectManager,
  MedusaContext,
  MedusaService,
  toMikroORMEntity,
} from "@medusajs/framework/utils"
import type { Context } from "@medusajs/framework/types"

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
import {
  consumeFifoForItemTx,
  reverseFifoForOrderTx,
  type ConsumeItemInput,
  type ConsumeItemResult,
  type ReverseResult,
} from "../../inventory-costing/fifo-tx"

type TxLogger = { info: (m: string) => void; warn: (m: string) => void }
const NOOP_LOGGER: TxLogger = { info: () => {}, warn: () => {} }

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
}) {
  /** DML modellerinin (cache'li) MikroORM entity referansları. */
  private fifoEntities() {
    return {
      Lot: toMikroORMEntity(InventoryCostLot),
      Allocation: toMikroORMEntity(CostAllocation),
    }
  }

  /**
   * Tek order_item için CONCURRENCY-GÜVENLİ FIFO tüketimi. `@InjectManager`
   * MikroORM manager'ı sağlar; engine PESSIMISTIC_WRITE kilidiyle transaction
   * içinde tüketir (oversell imkânsız, idempotent, aktivasyon guard'lı).
   */
  @InjectManager()
  async consumeFifoForItem(
    input: ConsumeItemInput,
    logger: TxLogger = NOOP_LOGGER,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<ConsumeItemResult> {
    return consumeFifoForItemTx(
      (sharedContext as { manager: unknown }).manager as never,
      this.fifoEntities(),
      input,
      logger
    )
  }

  /** Sipariş iptali/iadesi → CONCURRENCY-GÜVENLİ reversal (kilitli, immutable audit). */
  @InjectManager()
  async reverseFifoForOrder(
    input: { order_id: string },
    logger: TxLogger = NOOP_LOGGER,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<ReverseResult> {
    return reverseFifoForOrderTx(
      (sharedContext as { manager: unknown }).manager as never,
      this.fifoEntities(),
      input,
      logger
    )
  }
}

export default LotCostingService
