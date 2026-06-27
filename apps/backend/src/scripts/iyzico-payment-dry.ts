import { promises as fs } from "fs"
import path from "path"

import type { ExecArgs } from "@medusajs/framework/types"

import { DisabledIyzicoClient } from "../modules/iyzico-payment/client"
import { fakeSandboxConfig, redactedIyzicoConfig } from "../modules/iyzico-payment/config"
import { buildBasketPlan, deterministicIdempotencyKey } from "../modules/iyzico-payment/mapper"

const REPORTS_DIR = path.resolve(process.cwd(), "iyzico-payment-reports")
const LATEST_REPORT = path.join(REPORTS_DIR, "iyzico-payment-latest.json")

export default async function iyzicoPaymentDry({}: ExecArgs) {
  const startedAt = new Date().toISOString()
  const config = fakeSandboxConfig()
  const generatedIdempotencyKey = deterministicIdempotencyKey(["iyzico", "dry-run", "try", 228])
  const basket = buildBasketPlan({
    currency_code: "try",
    amount: 228,
    items: [{ id: "fixture-line", name: "Fixture Hair Product", amount: 169 }],
    shipping_amount: 59,
  })
  const client = new DisabledIyzicoClient(config)
  const init = await client.initializeCheckoutForm({
    amount: basket.amount,
    currency_code: "try",
    basket_id: `basket_${generatedIdempotencyKey.slice(0, 16)}`,
    conversation_id: generatedIdempotencyKey,
    callback_url: config.callbackUrl,
    return_url: config.returnUrl,
    idempotency_key: generatedIdempotencyKey,
  })
  const report = {
    run_id: `iyz_${Date.now().toString(36)}`,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    mode: "dry-run",
    decision: "IYZICO_PROVIDER_SKELETON_DRY_RUN_READY",
    provider_enabled: process.env.IYZICO_PROVIDER_ENABLED === "true",
    provider_id: "pp_iyzico_iyzico",
    config: redactedIyzicoConfig(config),
    config_names: [
      "IYZICO_MODE",
      "IYZICO_API_KEY",
      "IYZICO_SECRET_KEY",
      "IYZICO_BASE_URL",
      "IYZICO_CALLBACK_URL",
      "IYZICO_RETURN_URL",
      "IYZICO_WEBHOOK_SECRET",
      "IYZICO_NETWORK_ENABLED",
    ],
    basket,
    generated_idempotency_key: generatedIdempotencyKey,
    planned_provider_actions: ["initiatePayment", "authorizePayment", "capturePayment", "cancelPayment", "refundPayment", "webhookBoundary"],
    fake_initialize_status: init.provider_status,
    actual_network_calls: 0,
    actual_mutations: 0,
    db_writes: 0,
  }
  await fs.mkdir(REPORTS_DIR, { recursive: true })
  await fs.writeFile(path.join(REPORTS_DIR, `iyzico-payment-${report.finished_at.replace(/[:.]/g, "-")}.json`), JSON.stringify(report, null, 2))
  await fs.writeFile(LATEST_REPORT, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
