/**
 * Search Projection — MERKEZİ projeksiyon politikası (SAF, tek kaynak).
 *
 * Yalnız storefront'ta yayınlanabilir (`published`) ürünler projection'a girer.
 * draft / proposed / rejected (ve var olmayan/soft-deleted) ürünler projection
 * dışıdır; mevcut bir projection varsa GÜVENLİ biçimde kaldırılır (targeted
 * delete; RAW SQL yok).
 *
 * Politika sürümü değişince fingerprint değişir → eski commit confirm token'ları
 * (Catalog Batch Pipeline + Catalog Product Quarantine) otomatik geçersiz olur.
 */

/** Projeksiyon politikası sürümü. Bu kural değişirse arttır. */
export const PROJECTION_POLICY_VERSION = 2

/** Projection'a girebilecek Medusa ürün durumları (tek kaynak). */
export const PROJECTABLE_PRODUCT_STATUSES = ["published"] as const

export type ProjectableProductStatus =
  (typeof PROJECTABLE_PRODUCT_STATUSES)[number]

/**
 * Bir ürün durumu projeksiyona uygun mu? draft/proposed/rejected/null → false.
 * Tek-kaynak; backfill, writer, quarantine ve gelecekteki subscriber aynı
 * kararı kullanır.
 */
export function isProjectableStatus(
  status: string | null | undefined
): status is ProjectableProductStatus {
  return (
    typeof status === "string" &&
    (PROJECTABLE_PRODUCT_STATUSES as readonly string[]).includes(status)
  )
}
