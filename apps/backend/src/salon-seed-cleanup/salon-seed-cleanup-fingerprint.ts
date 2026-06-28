import { createHash } from "crypto"

export interface SalonSeedCleanupFingerprintPayload {
  policy_version: number
  product_ids: string[]
  handles: string[]
  current_statuses: Array<{ product_id: string; status: string }>
  current_sales_channel_ids: Array<{ product_id: string; sales_channel_ids: string[] }>
  projection_actions: Array<{ product_id: string; action: "remove" | "none" }>
  reference_counts: Array<{
    product_id: string
    active_cart_lines: number
    completed_cart_lines: number
    order_lines: number
    order_items: number
    blocking_order_lines: number
    safe_test_order_lines: number
  }>
}

function sha16(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16)
}

export function computeSalonSeedCleanupFingerprint(
  payload: SalonSeedCleanupFingerprintPayload
): string {
  const canonical = JSON.stringify({
    policy_version: payload.policy_version,
    product_ids: [...payload.product_ids].sort(),
    handles: [...payload.handles].sort(),
    current_statuses: [...payload.current_statuses].sort((a, b) =>
      a.product_id.localeCompare(b.product_id)
    ),
    current_sales_channel_ids: payload.current_sales_channel_ids
      .map((row) => ({
        product_id: row.product_id,
        sales_channel_ids: [...row.sales_channel_ids].sort(),
      }))
      .sort((a, b) => a.product_id.localeCompare(b.product_id)),
    projection_actions: [...payload.projection_actions].sort((a, b) =>
      a.product_id.localeCompare(b.product_id)
    ),
    reference_counts: [...payload.reference_counts].sort((a, b) =>
      a.product_id.localeCompare(b.product_id)
    ),
  })
  return sha16(canonical)
}
