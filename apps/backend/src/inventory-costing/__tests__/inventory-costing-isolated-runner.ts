/* eslint-disable no-console */
import assert from "assert"

import { computeAccuracy } from "../accuracy"
import {
  allocateFifo,
  lastPurchaseCost,
  reverseAllocation,
  weightedAverageCost,
} from "../fifo"
import { forecastDemand } from "../forecast"
import { computeProfit } from "../profit"
import { recommendPrice } from "../recommended-price"
import { recommendReorder } from "../reorder"
import { redactForRole, SENSITIVE_FIELDS, viewerRoleFromKeys } from "../redaction"
import { validateAndComputeStockEntry } from "../stock-entry"
import { CostLot, PlanningPolicy, ProductPricingPolicy, DailySale } from "../inventory-costing-types"

let passed = 0
function ok(cond: unknown, label: string): void {
  assert.ok(cond, label)
  passed++
}

const policy: ProductPricingPolicy = {
  sales_vat_rate: 0.2, payment_fee_rate: 0.02, platform_fee_rate: 0.01,
  packaging_cost: 5, shipping_contribution: 0, operational_cost: 10,
  minimum_profit_amount: 10, minimum_margin_rate: 0.1, target_margin_rate: 0.4,
  maximum_discount_rate: 0.3, rounding: { mode: "none", step: 0 },
}

function main(): void {
  // ── FIFO: senaryo (Parti1 20×100, Parti2 100×140) ──────────────────────────
  const lots: CostLot[] = [
    { lot_id: "L1", received_at: "2026-01-01", remaining_quantity: 20, effective_unit_cost: 100, status: "active" },
    { lot_id: "L2", received_at: "2026-02-01", remaining_quantity: 100, effective_unit_cost: 140, status: "active" },
  ]
  const a = allocateFifo(lots, 25) // 20 from L1, 5 from L2
  ok(a.ok && a.lines.length === 2, "1 fifo splits across lots")
  ok(a.lines[0].lot_id === "L1" && a.lines[0].allocated_quantity === 20, "2 oldest lot first")
  ok(a.lines[1].lot_id === "L2" && a.lines[1].allocated_quantity === 5, "3 remainder from next lot")
  ok(a.total_cost === 20 * 100 + 5 * 140, "4 fifo total cost = 2700")

  // oversell guard
  const over = allocateFifo(lots, 1000)
  ok(!over.ok && over.shortfall === 880 && over.error?.includes("oversell"), "5 oversell blocked")

  // reversal idempotent
  const rev1 = reverseAllocation(a.lines, false)
  ok(rev1.ok && rev1.restored.reduce((s, r) => s + r.quantity, 0) === 25, "6 reversal restores to original lots")
  const rev2 = reverseAllocation(a.lines, true)
  ok(rev2.ok && rev2.restored.length === 0 && rev2.error === "already_reversed_noop", "7 reversal idempotent")

  // weighted avg + last purchase
  ok(weightedAverageCost(lots) === Math.round((20 * 100 + 100 * 140) / 120 * 100) / 100, "8 weighted average")
  ok(lastPurchaseCost(lots) === 140, "9 last purchase cost")

  // ── Profit ─────────────────────────────────────────────────────────────────
  const pr = computeProfit({ gross_revenue: 300, discount: 0, product_cost: 100, refund: 0, policy })
  ok(pr.sales_vat === 50, "10 vat 300/1.2 -> 50")
  ok(pr.net_revenue_excl_vat === 250, "11 net excl vat 250")
  ok(pr.gross_profit === 150, "12 gross profit 250-100")
  ok(pr.net_profit < pr.gross_profit && !pr.loss, "13 net profit after fees, profitable")
  const loss = computeProfit({ gross_revenue: 90, discount: 0, product_cost: 100, refund: 0, policy })
  ok(loss.loss === true, "14 loss detected")

  // ── Recommended price ────────────────────────────────────────────────────────
  const rec = recommendPrice({ fifo_cost: 100, weighted_average_cost: 133.33, last_purchase_cost: 140, current_price: 150, policy })
  ok(rec.default_recommended_price !== null && rec.minimum_safe_price !== null, "15 price computed")
  ok((rec.default_recommended_price as number) >= (rec.last_purchase.recommended_price as number), "16 default = max of bases (safe)")
  ok(rec.loss_risk === true, "17 current 150 < min safe -> loss risk")
  ok(rec.fifo.estimated_profit !== null && (rec.fifo.estimated_profit as number) > 0, "18 fifo estimated profit positive")
  // missing cost blocks
  const noCost = recommendPrice({ fifo_cost: null, weighted_average_cost: null, last_purchase_cost: null, current_price: 100, policy })
  ok(noCost.default_recommended_price === null && noCost.error === "no_cost_basis", "19 missing cost -> no recommendation")
  // rounding charm
  const charm = recommendPrice({ fifo_cost: 100, weighted_average_cost: null, last_purchase_cost: null, current_price: null, policy: { ...policy, rounding: { mode: "charm_99", step: 0 } } })
  ok(String(charm.fifo.recommended_price).endsWith(".99"), "20 charm_99 rounding")

  // ── Forecast ─────────────────────────────────────────────────────────────────
  const steady: DailySale[] = Array.from({ length: 30 }, (_, i) => ({ date: `2026-05-${String(i + 1).padStart(2, "0")}`, quantity: 2 }))
  const f = forecastDemand({ history: steady, horizon_days: 30 })
  ok(Math.abs(f.predicted_demand - 60) < 12 && f.confidence_score > 0.5, "21 steady forecast ~60/mo, decent confidence")
  ok(f.classification === "fast_moving", "22 fast moving classification")
  // cold-start manual
  const cold = forecastDemand({ history: [], horizon_days: 30, manual_monthly_demand: 30 })
  ok(cold.predicted_demand === 30 && cold.confidence_score < 0.5 && cold.classification === "no_data", "23 cold-start manual, low confidence")
  // excluded (cancelled/test) + out_of_stock not counted as real demand
  const withNoise: DailySale[] = [
    ...steady,
    { date: "2026-06-01", quantity: 50, excluded: true },
    { date: "2026-06-02", quantity: 0, out_of_stock: true },
  ]
  const f2 = forecastDemand({ history: withNoise, horizon_days: 30 })
  ok(f2.predicted_demand < 120, "24 excluded/test sales not inflating demand")

  // ── Reorder ──────────────────────────────────────────────────────────────────
  const planPolicy: PlanningPolicy = {
    lead_time_days: 10, safety_stock_days: 5, target_cover_days: 30, minimum_order_quantity: 12,
    order_multiple: 6, maximum_stock_days: 90, service_level: 0.9, manual_monthly_demand: null, manual_override: false,
  }
  const ro = recommendReorder({ daily_forecast: 2, confidence_score: 0.7, available_stock: 10, reserved_stock: 0, inbound_stock: 0, policy: planPolicy, unit_cost_last: 140, unit_cost_weighted: 133.33 })
  ok(ro.reorder_point > 0 && ro.safety_stock > 0, "25 reorder point + safety stock")
  ok(ro.recommended_quantity % planPolicy.order_multiple === 0 && ro.recommended_quantity >= planPolicy.minimum_order_quantity, "26 MOQ + multiple rounding")
  ok(ro.status === "order_now", "27 below reorder point -> order now")
  ok(ro.estimated_budget_last_cost === ro.recommended_quantity * 140, "28 budget by last cost")
  // overstock
  const over2 = recommendReorder({ daily_forecast: 1, confidence_score: 0.7, available_stock: 200, reserved_stock: 0, inbound_stock: 0, policy: planPolicy, unit_cost_last: 100, unit_cost_weighted: 100 })
  ok(over2.status === "overstock" && over2.recommended_quantity === 0, "29 overstock -> 0 qty")
  // low confidence -> warn, no auto qty
  const lowc = recommendReorder({ daily_forecast: 2, confidence_score: 0.2, available_stock: 1, reserved_stock: 0, inbound_stock: 0, policy: planPolicy, unit_cost_last: 100, unit_cost_weighted: 100 })
  ok(lowc.status === "low_confidence" && lowc.recommended_quantity === 0, "30 low confidence -> warn not auto-order")

  // ── Accuracy ─────────────────────────────────────────────────────────────────
  const acc = computeAccuracy([{ predicted: 10, actual: 8 }, { predicted: 9, actual: 10 }, { predicted: 12, actual: 12 }])
  ok(acc.mae === 1 && acc.mape !== null && acc.bias !== 0, "31 MAE/MAPE/bias computed")
  ok(computeAccuracy([]).n === 0, "32 empty accuracy safe")

  // ── Redaction ────────────────────────────────────────────────────────────────
  const row = { product_id: "p1", remaining_quantity: 5, effective_unit_cost: 140, supplier_name: "X", net_profit: 100, nested: { unit_cost: 9, ok: 1 } }
  const editorView = redactForRole(row, "catalog_editor") as any
  ok(editorView.effective_unit_cost === undefined && editorView.supplier_name === undefined && editorView.net_profit === undefined, "33 catalog_editor cost fields redacted")
  ok(editorView.nested.unit_cost === undefined && editorView.nested.ok === 1 && editorView.remaining_quantity === 5, "34 deep redaction keeps non-sensitive")
  const ownerView = redactForRole(row, "owner") as any
  ok(ownerView.effective_unit_cost === 140 && ownerView.net_profit === 100, "35 owner sees full cost")
  ok(SENSITIVE_FIELDS.includes("supplier_id") && SENSITIVE_FIELDS.includes("weighted_average_cost"), "36 sensitive field list")

  // ── Stock entry (pure cost allocation) ──────────────────────────────────────
  const se = validateAndComputeStockEntry({ product_id: "p", variant_id: "v", received_quantity: 100, unit_purchase_cost: 100, purchase_vat_rate: 0.2, allocated_shipping_cost: 500, allocated_additional_cost: 0, idempotency_key: "k1" })
  ok(se.ok && se.effective_unit_cost === 105, "38 effective unit cost = 100 + 500/100")
  const seBad = validateAndComputeStockEntry({ product_id: "p", variant_id: "v", received_quantity: 0, unit_purchase_cost: -1, purchase_vat_rate: 2, idempotency_key: "" })
  ok(!seBad.ok && seBad.errors.includes("invalid_quantity") && seBad.errors.includes("missing_idempotency_key"), "39 stock entry validation fail-closed")

  // ── Viewer role mapping ─────────────────────────────────────────────────────
  ok(viewerRoleFromKeys(["catalog_editor"]) === "catalog_editor", "40 editor role")
  ok(viewerRoleFromKeys(["admin"]) === "owner", "41 admin -> owner view")
  ok(viewerRoleFromKeys([]) === "catalog_editor", "42 unknown -> safest (no cost)")

  // no raw SQL / no mutation guard
  const fs = require("fs") as typeof import("fs")
  const path = require("path") as typeof import("path")
  const dir = path.resolve(process.cwd(), "src", "inventory-costing")
  for (const file of fs.readdirSync(dir).filter((x: string) => x.endsWith(".ts"))) {
    const c = fs.readFileSync(path.join(dir, file), "utf-8")
    ok(!/\b(INSERT|UPDATE|DELETE)\s+.*\b(INTO|SET|FROM)\b|core-flows|\.upsert\(/i.test(c), `37 no SQL/mutation in ${file}`)
  }

  console.log(`[inventory-costing:test] ${passed} assertions passed`)
}

try {
  main()
} catch (e) {
  console.error("INVENTORY COSTING TEST FAILED:", e instanceof Error ? e.message : e)
  process.exit(1)
}
