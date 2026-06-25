import { CatalogTotals } from "./catalog-batch-types"

/** Dry-run sonunda kullanıcıya verilecek kesin commit komutu. */
export function buildCommitCommand(
  externalIds: string[],
  discoveryLimit: number,
  fingerprint: string
): string {
  const ids = [...externalIds].sort().join(",")
  return (
    `cd ~/sac-ecommerce/apps/backend && env ` +
    `CATALOG_EXTERNAL_IDS=${ids} ` +
    `CATALOG_DISCOVERY_LIMIT=${discoveryLimit} ` +
    `CATALOG_PIPELINE_COMMIT=true ` +
    `CATALOG_PIPELINE_CONFIRM=${fingerprint} ` +
    `npm run catalog:batch`
  )
}

/** Batch sonrası beklenen toplamlar (mevcut totals + requested). */
export function predictExpectedAfter(
  totals: CatalogTotals | null,
  requested: number
): { product_total: number; aveda_metadata_v2_total: number; projection_total: number } {
  const product = totals?.product ?? 0
  const v2 = totals?.aveda_metadata_v2 ?? 0
  const projection = totals?.projection_rows ?? 0
  return {
    product_total: product + requested,
    aveda_metadata_v2_total: v2 + requested,
    projection_total: projection + requested,
  }
}
