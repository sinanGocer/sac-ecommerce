import { Module } from "@medusajs/framework/utils"

import SearchProjectionService from "./service"

/**
 * Search Projection — Medusa modülü.
 *
 * Bu adımda: model + servis + modül kaydı + migration DOSYASI.
 * BİLEREK YAPILMADI (sonraki onaylı adımlar): migration'ı çalıştırma,
 * subscriber/event listener, read API, Redis/Typesense, backfill yazımı.
 *
 * Modül medusa-config.ts'e kaydedildi; ancak migration uygulanmadığı için
 * tablo henüz yoktur. Boot güvenlidir: bu servisi sorgulayan bir yol
 * (subscriber/API) henüz yok, dolayısıyla eksik tablo bir hata üretmez.
 */
export const SEARCH_PROJECTION_MODULE = "searchProjection"

export default Module(SEARCH_PROJECTION_MODULE, {
  service: SearchProjectionService,
})

// Saf yardımcılar dış kullanım için yeniden ihraç edilir.
export * from "./search-projection.types"
export * from "./projection-builder"
export * from "./model-plan"
