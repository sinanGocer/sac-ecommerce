import { Module } from "@medusajs/framework/utils"

import LotCostingService from "./service"

/**
 * Lot Costing & Forecasting — Medusa modülü.
 *
 * Model + servis + modül kaydı + migration DOSYASI. Migration UYGULANMADI →
 * tablo henüz yok. Boot güvenlidir: bu servisi sorgulayan bir yol (subscriber/
 * API/job) henüz yok, dolayısıyla eksik tablo hata üretmez (search-projection
 * ile aynı güvenli desen).
 */
export const LOT_COSTING_MODULE = "lotCosting"

export default Module(LOT_COSTING_MODULE, {
  service: LotCostingService,
})
