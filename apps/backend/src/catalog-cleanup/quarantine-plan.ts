/**
 * Catalog Product Quarantine — SAF plan mantığı (IO yok, deterministik).
 *
 * - Allowlist gate (requested=1, matched=1)
 * - Kimlik + provenance gate (external_id/SKU/brand/status/metadata_version/source_url)
 * - Referans gate (delete asla; unpublish cart'tan etkilenmez)
 * - Planlı aksiyon üretimi (planned | no_op)
 */

import { isProjectableStatus } from "../modules/search-projection/projection-policy"
import {
  ExpectedIdentity,
  PlannedAction,
  ProductSnapshot,
  ReferenceCounts,
  TARGET_PRODUCT_STATUS,
} from "./quarantine-policy"

// ── Allowlist ────────────────────────────────────────────────────────────────

export interface AllowlistResult {
  requested_product_id: string
  matched_product_ids: string[]
  requested_count: number
  matched_count: number
  matched_product_id: string | null
  ok: boolean
  reason: string | null
}

/**
 * Tek-ürün allowlist gate. requestedId tam olarak izinli ID olmalı ve DB'den
 * dönen eşleşme TAM 1 olmalı. Aksi halde fail-closed (plan üretilmez).
 */
export function evaluateAllowlist(
  requestedId: string,
  allowlistedId: string,
  matchedProductIds: string[]
): AllowlistResult {
  const requestedCount = requestedId === allowlistedId ? 1 : 0
  const matched = [...new Set(matchedProductIds)]
  const ok = requestedCount === 1 && matched.length === 1 && matched[0] === allowlistedId
  let reason: string | null = null
  if (requestedId !== allowlistedId) reason = "requested_not_allowlisted"
  else if (matched.length === 0) reason = "product_not_found"
  else if (matched.length > 1) reason = "multiple_matches"
  else if (matched[0] !== allowlistedId) reason = "matched_id_mismatch"
  return {
    requested_product_id: requestedId,
    matched_product_ids: matched,
    requested_count: requestedCount,
    matched_count: matched.length,
    matched_product_id: ok ? matched[0] : null,
    ok,
    reason,
  }
}

// ── Kimlik + provenance ───────────────────────────────────────────────────────

export interface IdentityMismatch {
  field: string
  expected: unknown
  actual: unknown
}

export interface IdentityResult {
  ok: boolean
  mismatches: IdentityMismatch[]
  identity_snapshot: Record<string, unknown>
}

/** URL'i alfanümerik küçük harfe katlar (token karşılaştırması için). */
function foldUrl(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** Host beklenen domende mi (alt alan adları dahil)? */
function hostMatches(host: string, expected: string): boolean {
  return host === expected || host.endsWith(`.${expected}`)
}

/**
 * Kimlik + provenance gate. Yalnız title'a güvenmez; external_id, SKU, brand,
 * status, metadata_version ve source_url (host + token) birlikte doğrulanır.
 * Herhangi biri uyuşmazsa ok=false → çağıran QUARANTINE_STALE_PLAN üretir.
 */
export function evaluateIdentity(
  snapshot: ProductSnapshot,
  expected: ExpectedIdentity
): IdentityResult {
  const md = snapshot.metadata ?? {}
  const externalId = md.external_id
  const brand = md.brand
  const metadataVersion = md.metadata_version
  const sourceUrl = typeof md.source_url === "string" ? md.source_url : null
  const sourceHost = sourceUrl ? hostOf(sourceUrl) : null
  const foldedUrl = sourceUrl ? foldUrl(sourceUrl) : ""

  const mismatches: IdentityMismatch[] = []
  const push = (field: string, exp: unknown, act: unknown): void => {
    mismatches.push({ field, expected: exp, actual: act })
  }

  if (snapshot.product_id !== expected.product_id) {
    push("product_id", expected.product_id, snapshot.product_id)
  }
  if (externalId !== expected.external_id) {
    push("external_id", expected.external_id, externalId ?? null)
  }
  if (!snapshot.variant_skus.includes(expected.sku)) {
    push("sku", expected.sku, snapshot.variant_skus)
  }
  if (brand !== expected.brand) {
    push("brand", expected.brand, brand ?? null)
  }
  if (snapshot.status !== expected.status) {
    push("status", expected.status, snapshot.status)
  }
  if (metadataVersion !== expected.metadata_version) {
    push("metadata_version", expected.metadata_version, metadataVersion ?? null)
  }
  if (snapshot.title !== expected.title) {
    push("title", expected.title, snapshot.title)
  }
  if (!sourceUrl) {
    push("source_url", `${expected.source_host}/...`, null)
  } else {
    if (!sourceHost || !hostMatches(sourceHost, expected.source_host)) {
      push("source_url_host", expected.source_host, sourceHost)
    }
    if (!foldedUrl.includes(expected.source_url_token)) {
      push("source_url_token", expected.source_url_token, sourceUrl)
    }
  }

  return {
    ok: mismatches.length === 0,
    mismatches,
    identity_snapshot: {
      product_id: snapshot.product_id,
      title: snapshot.title,
      status: snapshot.status,
      external_id: externalId ?? null,
      brand: brand ?? null,
      metadata_version: metadataVersion ?? null,
      sku: snapshot.variant_skus,
      source_url: sourceUrl,
      source_host: sourceHost,
      sync_provider: md.sync_provider ?? null,
    },
  }
}

// ── Referans gate ─────────────────────────────────────────────────────────────

export interface ReferenceResult {
  /** Cart line unpublish'i ASLA engellemez. */
  unpublish_allowed: boolean
  /** Bu araç hiçbir koşulda delete üretmez → her zaman false. */
  delete_allowed: false
  /** Politikadan bağımsız: delete TEKNİK olarak güvenli olur muydu? */
  delete_would_be_safe: boolean
  delete_blockers: string[]
  order_reference_count: number
}

export function evaluateReferences(counts: ReferenceCounts): ReferenceResult {
  const orderReferences = counts.order_lines + counts.order_items
  const blockers: string[] = []
  // Aktif cart line delete'i engeller (unpublish'i DEĞİL).
  if (counts.active_cart_lines > 0) blockers.push("active_cart_lines")
  // Order line/item varsa delete hiçbir şekilde güvenli değildir.
  if (counts.order_lines > 0) blockers.push("order_lines")
  if (counts.order_items > 0) blockers.push("order_items")
  return {
    unpublish_allowed: true,
    delete_allowed: false,
    delete_would_be_safe: blockers.length === 0,
    delete_blockers: blockers,
    order_reference_count: orderReferences,
  }
}

// ── Planlı aksiyonlar ─────────────────────────────────────────────────────────

/**
 * Üç planlı aksiyon üretir. Hedef durum zaten sağlanmışsa aksiyon `no_op`.
 * Dry-run'da hiçbiri çalıştırılmaz (executed=false, db_writes=0).
 */
export function buildPlannedActions(snapshot: ProductSnapshot): PlannedAction[] {
  const currentChannelIds = snapshot.sales_channels.map((c) => c.id).sort()

  const productNoOp = snapshot.status === TARGET_PRODUCT_STATUS
  const channelNoOp = currentChannelIds.length === 0
  // Merkezi politika: hedef durum (draft) projeksiyona uygun DEĞİL → mevcut
  // projection kaldırılmalı. Hedef projeksiyona uygun olsaydı (ileride) ve
  // projection zaten varsa kaldırma gerekmezdi.
  const targetProjectable = isProjectableStatus(TARGET_PRODUCT_STATUS)
  const projectionNoOp = snapshot.projection === null || targetProjectable

  return [
    {
      action: "PRODUCT_UNPUBLISH",
      status: productNoOp ? "no_op" : "planned",
      executed: false,
      db_writes: 0,
      detail: {
        current_status: snapshot.status,
        target_status: TARGET_PRODUCT_STATUS,
      },
    },
    {
      action: "SALES_CHANNEL_DETACH",
      status: channelNoOp ? "no_op" : "planned",
      executed: false,
      db_writes: 0,
      detail: {
        current_sales_channel_ids: currentChannelIds,
        current_sales_channel_names: snapshot.sales_channels
          .map((c) => c.name)
          .filter((n): n is string => typeof n === "string"),
        detach_target_ids: currentChannelIds,
        expected_remaining_relations: 0,
      },
    },
    {
      action: "PROJECTION_REMOVE_OR_HIDE",
      status: projectionNoOp ? "no_op" : "planned",
      executed: false,
      db_writes: 0,
      detail: {
        current_projection_exists: snapshot.projection !== null,
        projection_action: projectionNoOp ? "none" : "remove",
        projection_id: snapshot.projection?.id ?? null,
        expected_projection_count_after_commit: 0,
      },
    },
  ]
}
