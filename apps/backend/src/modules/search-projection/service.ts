import { MedusaService } from "@medusajs/framework/utils"

import ProductSearchProjection from "./models/product-search-projection"

/**
 * Search Projection modül servisi.
 *
 * MedusaService, model için otomatik CRUD üretir
 * (createProductSearchProjections, listProductSearchProjections, vb.).
 *
 * Bu aşamada yalnızca model + servis + modül kaydı yapılır.
 * Yazma/okuma kullanımları (backfill writer, subscriber, read API) sonraki
 * onaylı adımlarda eklenecek; bu serviste henüz özel iş mantığı YOKTUR.
 */
class SearchProjectionService extends MedusaService({
  ProductSearchProjection,
}) {}

export default SearchProjectionService
