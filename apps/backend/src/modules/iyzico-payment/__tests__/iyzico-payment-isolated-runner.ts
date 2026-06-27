import assert from "assert"
import { PaymentSessionStatus } from "@medusajs/framework/utils"

import { DisabledIyzicoClient } from "../client"
import { fakeSandboxConfig, parseIyzicoConfig, redactedIyzicoConfig } from "../config"
import { IyzicoPaymentError } from "../errors"
import {
  assertTryPayment,
  buildBasketPlan,
  buildInitialSessionData,
  deterministicIdempotencyKey,
  hasSensitiveValue,
  mapProviderStatus,
  parseSessionData,
} from "../mapper"
import IyzicoPaymentProviderService from "../service"
import { handleIyzicoWebhookBoundary } from "../webhook"

let assertions = 0
const ok = (v: unknown, m: string) => { assertions++; assert.ok(v, m) }
const eq = <T>(a: T, e: T, m: string) => { assertions++; assert.deepStrictEqual(a, e, m) }
const throwsCode = (fn: () => unknown, code: string, m: string) => {
  assertions++
  assert.throws(fn, (e) => e instanceof IyzicoPaymentError && e.code === code, m)
}
const rejectsCode = async (fn: () => Promise<unknown>, code: string, m: string) => {
  assertions++
  await assert.rejects(fn, (e) => e instanceof IyzicoPaymentError && e.code === code, m)
}

async function main() {
  const sandbox = fakeSandboxConfig()
  ok(parseIyzicoConfig({ mode: "sandbox", apiKey: "sandbox-key", secretKey: "sandbox-secret", baseUrl: "https://sandbox-api.iyzipay.com", callbackUrl: "http://localhost:9000/hooks/iyzico", returnUrl: "http://localhost:8000/tr/checkout" }, { NODE_ENV: "test" } as NodeJS.ProcessEnv).mode === "sandbox", "1 sandbox config valid")
  ok(parseIyzicoConfig({ mode: "production", apiKey: "prod-key", secretKey: "prod-secret", baseUrl: "https://api.iyzipay.com", callbackUrl: "https://store.example.com/hooks/iyzico", returnUrl: "https://store.example.com/checkout" }, { NODE_ENV: "production" } as NodeJS.ProcessEnv).mode === "production", "2 production config valid")
  throwsCode(() => parseIyzicoConfig({ mode: "dev" }, { NODE_ENV: "test" } as NodeJS.ProcessEnv), "invalid_mode", "3 invalid mode blocked")
  throwsCode(() => parseIyzicoConfig({ ...sandbox, apiKey: "" }, { NODE_ENV: "test" } as NodeJS.ProcessEnv), "missing_config", "4 missing key blocked")
  throwsCode(() => parseIyzicoConfig({ ...sandbox, baseUrl: "https://api.iyzipay.com" }, { NODE_ENV: "test" } as NodeJS.ProcessEnv), "sandbox_live_url_mismatch", "5 sandbox/live URL mismatch blocked")
  ok(!JSON.stringify(redactedIyzicoConfig(sandbox)).includes("sandbox-secret-key"), "6 secrets redacted")
  eq(sandbox.networkEnabled, false, "7 network disabled default")

  eq(deterministicIdempotencyKey(["a", "b", 1]), deterministicIdempotencyKey(["a", "b", 1]), "8 deterministic idempotency key")
  eq(assertTryPayment("try", 10), 10, "9 TRY valid")
  throwsCode(() => assertTryPayment("eur", 10), "currency_not_supported", "10 non-TRY blocked")
  throwsCode(() => assertTryPayment("try", 0), "invalid_amount", "11 zero amount blocked")
  throwsCode(() => parseSessionData({ provider: "iyzico" }), "malformed_session_data", "12 malformed session data blocked")

  eq(buildBasketPlan({ currency_code: "try", amount: 15, items: [{ id: "i1", name: "Item", amount: 10 }], shipping_amount: 5 }).amount, 15, "13 basket/payment total matches")
  throwsCode(() => buildBasketPlan({ currency_code: "try", amount: 16, items: [{ id: "i1", name: "Item", amount: 10 }], shipping_amount: 5 }), "basket_total_mismatch", "14 mismatch blocked")
  eq(buildBasketPlan({ currency_code: "try", amount: "10.11", items: [{ id: "i1", name: "Item", amount: "10.105" }], shipping_amount: 0 }).items[0].amount, 10.11, "15 decimal rounding deterministic")
  eq(buildBasketPlan({ currency_code: "try", amount: 20, items: [{ id: "i1", name: "Item", amount: 15 }], shipping_amount: 5 }).shipping_amount, 5, "16 shipping included exactly once")

  eq(mapProviderStatus("requires_action"), PaymentSessionStatus.REQUIRES_MORE, "17 requires_action mapping")
  eq(mapProviderStatus("authorized"), PaymentSessionStatus.AUTHORIZED, "18 authorized mapping")
  eq(mapProviderStatus("captured"), PaymentSessionStatus.CAPTURED, "19 captured mapping")
  eq(mapProviderStatus("canceled"), PaymentSessionStatus.CANCELED, "20 canceled mapping")
  eq(mapProviderStatus("failed"), PaymentSessionStatus.ERROR, "21 failed mapping")
  throwsCode(() => mapProviderStatus("wat"), "unknown_provider_status", "22 unknown status blocked")

  const provider = new IyzicoPaymentProviderService({}, sandbox)
  const init = await provider.initiatePayment({ amount: 25, currency_code: "try", context: { idempotency_key: "cart_1" } })
  eq(init.status, PaymentSessionStatus.REQUIRES_MORE, "23 initiate fake sandbox success")
  await rejectsCode(async () => new DisabledIyzicoClient({ ...sandbox, networkEnabled: true }).initializeCheckoutForm({ amount: 1, currency_code: "try", basket_id: "b", conversation_id: "c", callback_url: sandbox.callbackUrl, return_url: sandbox.returnUrl, idempotency_key: "k" }), "transport_not_implemented", "24 network disabled prevents real call")
  await rejectsCode(async () => provider.authorizePayment({ data: buildInitialSessionData({ mode: "sandbox", amount: 10, currency_code: "try", idempotency_key: "k" }) }), "authorization_evidence_missing", "25 authorize without verified provider result blocked")
  await rejectsCode(async () => provider.capturePayment({ data: { ...(init.data as Record<string, unknown>), provider_status: "authorized", captured_at: "x" } }), "duplicate_capture", "26 duplicate capture blocked")
  await rejectsCode(async () => provider.refundPayment({ amount: 1, data: init.data }), "refund_without_capture", "27 refund without capture blocked")
  await rejectsCode(async () => provider.refundPayment({ amount: 20, data: { ...(init.data as Record<string, unknown>), provider_status: "captured", captured_amount: 10, captured_at: "x" } }), "over_refund", "28 over-refund blocked")
  const del1 = await provider.deletePayment({ data: init.data })
  const del2 = await provider.deletePayment({ data: del1.data })
  ok(Boolean(del2.data?.deleted_locally), "29 delete session idempotent")
  eq(hasSensitiveValue({ card_number: "4111111111111111" }), true, "30 sensitive data detected")

  const client = new DisabledIyzicoClient(sandbox)
  const now = Date.now()
  const rawBody = JSON.stringify({ event_id: "evt_1", provider_status: "authorized", provider_payment_id: "pay_1" })
  eq((await handleIyzicoWebhookBoundary({ client, rawBody, timestamp: String(now), secret: "s" })).decision, "WEBHOOK_BLOCKED", "31 missing signature blocked")
  eq((await handleIyzicoWebhookBoundary({ client, rawBody, timestamp: String(now), secret: "s", signature: "bad" })).decision, "WEBHOOK_BLOCKED", "32 invalid signature blocked")
  eq((await handleIyzicoWebhookBoundary({ client, rawBody, timestamp: String(now - 999999), secret: "s", signature: "valid-test-signature", now })).decision, "WEBHOOK_BLOCKED", "33 stale timestamp blocked")
  eq((await handleIyzicoWebhookBoundary({ client, rawBody, timestamp: String(now), secret: "s", signature: "valid-test-signature", now, seenEventIds: new Set(["evt_1"]) })).decision, "WEBHOOK_DUPLICATE", "34 duplicate event recognized")
  const unsupported = await handleIyzicoWebhookBoundary({ client, rawBody: JSON.stringify({ event_id: "evt_2", provider_status: "refunded" }), timestamp: String(now), secret: "s", signature: "valid-test-signature", now })
  eq(unsupported.decision, "WEBHOOK_NORMALIZED", "35 unsupported event ignored/fail-closed")
  eq(unsupported.db_writes, 0, "36 valid normalized event produces no DB write")

  console.log(`iyzico payment isolated assertions passed: ${assertions}/36`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
