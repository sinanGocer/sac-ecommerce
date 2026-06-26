/**
 * Türkiye Shipping Setup — SAF aşama planlama (IO yok, deterministik).
 *
 * Snapshot + config → sıralı aşamalar (planned | no_op | skipped | conflict |
 * blocked). Avrupa zone / European Warehouse'a dokunmaz; mevcut doğru kaynakları
 * yeniden kullanır (no_op), eksikleri planlar, çakışmaları fail-closed bildirir.
 */

import {
  PROTECTED,
  StageResult,
  TARGET,
  TrShippingConfig,
  TrShippingSnapshot,
} from "./tr-shipping-policy"

export function evaluateTrShippingStages(
  snapshot: TrShippingSnapshot,
  config: TrShippingConfig
): StageResult[] {
  const stages: StageResult[] = []

  // ── 1) STOCK_LOCATION_CREATE_OR_REUSE ──────────────────────────────────────
  const slMatches = snapshot.stock_locations.filter(
    (s) => s.name === TARGET.stock_location_name
  )
  let trStockLocationId: string | null = null
  {
    let status: StageResult["status"] = "planned"
    let gate: string | null = null
    let writes = 1
    if (slMatches.length > 1) {
      status = "conflict"
      gate = "duplicate_stock_location"
      writes = 0
    } else if (slMatches.length === 1) {
      status = "no_op"
      writes = 0
      trStockLocationId = slMatches[0].id
    }
    stages.push({
      stage: "STOCK_LOCATION_CREATE_OR_REUSE",
      status,
      executed: false,
      estimated_writes: writes,
      current_state: { matched_count: slMatches.length, matched_ids: slMatches.map((s) => s.id) },
      target_state: { name: TARGET.stock_location_name, country_code: TARGET.country_code },
      dependency_ids: { stock_location_id: trStockLocationId },
      gate,
    })
  }

  // ── 2) STOCK_LOCATION_SALES_CHANNEL_LINK ───────────────────────────────────
  {
    let status: StageResult["status"] = "planned"
    let gate: string | null = null
    let writes = 1
    if (!snapshot.sales_channel_id) {
      status = "blocked"
      gate = "sales_channel_unresolved"
      writes = 0
    } else if (trStockLocationId) {
      const sl = slMatches[0]
      if (sl.sales_channel_ids.includes(snapshot.sales_channel_id)) {
        status = "no_op"
        writes = 0
      }
    }
    stages.push({
      stage: "STOCK_LOCATION_SALES_CHANNEL_LINK",
      status,
      executed: false,
      estimated_writes: writes,
      current_state: {
        stock_location_exists: !!trStockLocationId,
        linked: trStockLocationId
          ? slMatches[0].sales_channel_ids.includes(snapshot.sales_channel_id ?? "")
          : false,
      },
      target_state: { sales_channel_id: snapshot.sales_channel_id },
      dependency_ids: {
        stock_location_id: trStockLocationId,
        sales_channel_id: snapshot.sales_channel_id,
      },
      gate,
    })
  }

  // ── 3) FULFILLMENT_SET_CREATE_OR_REUSE ─────────────────────────────────────
  const fsMatches = snapshot.fulfillment_sets.filter(
    (f) => f.name === TARGET.fulfillment_set_name
  )
  let trFulfillmentSetId: string | null = null
  {
    let status: StageResult["status"] = "planned"
    let gate: string | null = null
    let writes = 1
    if (fsMatches.length > 1) {
      status = "conflict"
      gate = "duplicate_fulfillment_set"
      writes = 0
    } else if (fsMatches.length === 1) {
      status = "no_op"
      writes = 0
      trFulfillmentSetId = fsMatches[0].id
    }
    stages.push({
      stage: "FULFILLMENT_SET_CREATE_OR_REUSE",
      status,
      executed: false,
      estimated_writes: writes,
      current_state: { matched_count: fsMatches.length, matched_ids: fsMatches.map((f) => f.id) },
      target_state: { name: TARGET.fulfillment_set_name, type: TARGET.fulfillment_set_type },
      dependency_ids: { fulfillment_set_id: trFulfillmentSetId },
      gate,
    })
  }

  // ── 4) SERVICE_ZONE_CREATE_OR_REUSE ────────────────────────────────────────
  const szMatches = snapshot.service_zones.filter(
    (z) => z.name === TARGET.service_zone_name
  )
  let trServiceZoneId: string | null = null
  {
    let status: StageResult["status"] = "planned"
    let gate: string | null = null
    let writes = 1
    // "Türkiye" zone farklı (TR olmayan) bir fulfillment set altında ise conflict.
    const wrongSet = szMatches.find(
      (z) =>
        z.fulfillment_set_id !== null &&
        trFulfillmentSetId !== null &&
        z.fulfillment_set_id !== trFulfillmentSetId
    )
    if (szMatches.length > 1) {
      status = "conflict"
      gate = "duplicate_service_zone"
      writes = 0
    } else if (wrongSet) {
      status = "conflict"
      gate = "service_zone_wrong_fulfillment_set"
      writes = 0
    } else if (szMatches.length === 1) {
      status = "no_op"
      writes = 0
      trServiceZoneId = szMatches[0].id
    }
    stages.push({
      stage: "SERVICE_ZONE_CREATE_OR_REUSE",
      status,
      executed: false,
      estimated_writes: writes,
      current_state: { matched_count: szMatches.length, matched_ids: szMatches.map((z) => z.id) },
      target_state: { name: TARGET.service_zone_name, fulfillment_set: TARGET.fulfillment_set_name },
      dependency_ids: { service_zone_id: trServiceZoneId, fulfillment_set_id: trFulfillmentSetId },
      gate,
    })
  }

  // ── 5) GEO_ZONE_TR_CREATE_OR_REUSE ─────────────────────────────────────────
  {
    let status: StageResult["status"] = "planned"
    let gate: string | null = null
    let writes = 1
    const zonesWithTr = snapshot.service_zones.filter((z) =>
      z.geo_country_codes.includes(TARGET.country_code)
    )
    const trInProtected = zonesWithTr.find((z) =>
      (PROTECTED.service_zone_names as readonly string[]).includes(z.name)
    )
    const trInOtherZone = zonesWithTr.find(
      (z) => z.name !== TARGET.service_zone_name
    )
    if (trInProtected) {
      status = "conflict"
      gate = "tr_geo_in_protected_zone"
      writes = 0
    } else if (trInOtherZone) {
      status = "conflict"
      gate = "tr_geo_in_other_zone"
      writes = 0
    } else if (zonesWithTr.length > 0) {
      status = "no_op"
      writes = 0
    }
    stages.push({
      stage: "GEO_ZONE_TR_CREATE_OR_REUSE",
      status,
      executed: false,
      estimated_writes: writes,
      current_state: {
        zones_with_tr: zonesWithTr.map((z) => ({ id: z.id, name: z.name })),
      },
      target_state: { country_code: TARGET.country_code, service_zone: TARGET.service_zone_name },
      dependency_ids: { service_zone_id: trServiceZoneId },
      gate,
    })
  }

  // ── 6) SHIPPING_OPTION_CREATE_OR_REUSE ─────────────────────────────────────
  {
    let status: StageResult["status"] = "planned"
    let gate: string | null = null
    let writes = 1
    const optMatches = snapshot.shipping_options.filter(
      (o) => o.name === config.option_name
    )
    if (!snapshot.shipping_profile_id) {
      status = "blocked"
      gate = "shipping_profile_unresolved"
      writes = 0
    } else if (optMatches.length > 1) {
      status = "conflict"
      gate = "duplicate_shipping_option"
      writes = 0
    } else if (optMatches.length === 1) {
      const o = optMatches[0]
      const structurallyEqual =
        o.provider_id === TARGET.provider_id &&
        o.price_type === "flat" &&
        (o.currency === null || o.currency === config.currency) &&
        o.flat_amount === config.flat_amount &&
        (o.shipping_profile_id === null ||
          o.shipping_profile_id === snapshot.shipping_profile_id)
      if (structurallyEqual) {
        status = "no_op"
        writes = 0
      } else {
        status = "conflict"
        gate = "shipping_option_structure_conflict"
        writes = 0
      }
    }
    stages.push({
      stage: "SHIPPING_OPTION_CREATE_OR_REUSE",
      status,
      executed: false,
      estimated_writes: writes,
      current_state: {
        matched_count: optMatches.length,
        matched: optMatches.map((o) => ({
          id: o.id,
          provider_id: o.provider_id,
          price_type: o.price_type,
          flat_amount: o.flat_amount,
          currency: o.currency,
          shipping_profile_id: o.shipping_profile_id,
        })),
      },
      target_state: {
        name: config.option_name,
        provider_id: TARGET.provider_id,
        price_type: "flat",
        flat_amount: config.flat_amount,
        currency: config.currency,
        shipping_profile_id: snapshot.shipping_profile_id,
        service_zone: TARGET.service_zone_name,
      },
      dependency_ids: {
        service_zone_id: trServiceZoneId,
        shipping_profile_id: snapshot.shipping_profile_id,
      },
      gate,
    })
  }

  // ── 7) FREE_SHIPPING_RULE_CREATE_OR_REUSE ──────────────────────────────────
  {
    const hasThreshold = config.free_threshold !== null
    stages.push({
      stage: "FREE_SHIPPING_RULE_CREATE_OR_REUSE",
      status: hasThreshold ? "planned" : "skipped",
      executed: false,
      estimated_writes: 0, // ücretsiz kargo modeli framework doğrulaması gerektirir (ayrı paket)
      current_state: { free_threshold: config.free_threshold },
      target_state: hasThreshold
        ? {
            note:
              "Free-shipping eşiği Medusa price-rule/promotion modeliyle ayrı pakette doğrulanmalı; bu turda yalnız planlanır, yazım yok.",
            free_threshold: config.free_threshold,
          }
        : { note: "threshold verilmedi → atlandı" },
      dependency_ids: {},
      gate: null,
    })
  }

  // ── 8) STORE_API_VISIBILITY_VERIFY (read-only verify, asla yazmaz) ─────────
  {
    const optOk = snapshot.shipping_options.some(
      (o) =>
        o.name === config.option_name &&
        o.provider_id === TARGET.provider_id &&
        o.flat_amount === config.flat_amount
    )
    const trGeoOk = snapshot.service_zones.some(
      (z) =>
        z.name === TARGET.service_zone_name &&
        z.geo_country_codes.includes(TARGET.country_code)
    )
    stages.push({
      stage: "STORE_API_VISIBILITY_VERIFY",
      status: optOk && trGeoOk ? "no_op" : "planned",
      executed: false,
      estimated_writes: 0,
      current_state: { option_present: optOk, tr_geo_present: trGeoOk },
      target_state: {
        expectation:
          "Kurulum sonrası TR cart için /store/shipping-options ≥ 1 seçenek döndürmeli",
      },
      dependency_ids: {},
      gate: null,
    })
  }

  return stages
}
