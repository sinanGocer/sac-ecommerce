import crypto from "crypto"

import { PaymentActions, PaymentSessionStatus } from "@medusajs/framework/utils"

import { fail } from "./errors"
import type {
  IyzicoBasketPlan,
  IyzicoPaymentSessionData,
  IyzicoProviderStatus,
  IyzicoWebhookEvent,
} from "./types"

export function toNumberAmount(input: unknown): number {
  if (typeof input === "number") return input
  if (typeof input === "string" && input.trim()) return Number(input)
  if (input && typeof input === "object" && "value" in input) return Number((input as { value: unknown }).value)
  return Number.NaN
}

export function assertTryPayment(currencyCode: string, amountInput: unknown, maxSandboxAmount = 10000): number {
  if (currencyCode.toLowerCase() !== "try") fail("currency_not_supported", "Iyzico skeleton only accepts TRY.")
  const amount = toNumberAmount(amountInput)
  if (!Number.isFinite(amount) || amount <= 0) fail("invalid_amount", "Payment amount must be positive.")
  if (amount > maxSandboxAmount) fail("sandbox_amount_limit", "Sandbox amount exceeds safety limit.")
  return roundMoney(amount)
}

export function deterministicIdempotencyKey(parts: Array<string | number | null | undefined>): string {
  return crypto.createHash("sha256").update(parts.map((p) => String(p ?? "")).join("|")).digest("hex").slice(0, 32)
}

export function buildInitialSessionData(input: {
  mode: "sandbox" | "production"
  amount: number
  currency_code: "try"
  idempotency_key: string
  checkout_form_token?: string
  payment_page_url?: string
}): IyzicoPaymentSessionData {
  return {
    provider: "iyzico",
    mode: input.mode,
    conversation_id: input.idempotency_key,
    basket_id: `basket_${input.idempotency_key.slice(0, 16)}`,
    checkout_form_token: input.checkout_form_token,
    payment_page_url: input.payment_page_url,
    provider_status: "requires_action",
    idempotency_key: input.idempotency_key,
    initialized_at: new Date(0).toISOString(),
  }
}

export function parseSessionData(data: unknown): IyzicoPaymentSessionData {
  if (!data || typeof data !== "object") fail("malformed_session_data", "Iyzico session data is missing.")
  const d = data as Partial<IyzicoPaymentSessionData>
  if (d.provider !== "iyzico" || !d.mode || !d.conversation_id || !d.basket_id || !d.idempotency_key) {
    fail("malformed_session_data", "Iyzico session data failed validation.")
  }
  if (d.mode !== "sandbox" && d.mode !== "production") fail("malformed_session_data", "Invalid Iyzico mode in session data.")
  return d as IyzicoPaymentSessionData
}

export function mapProviderStatus(status: string): PaymentSessionStatus {
  switch (status as IyzicoProviderStatus) {
    case "initialized":
    case "pending":
      return PaymentSessionStatus.PENDING
    case "requires_action":
      return PaymentSessionStatus.REQUIRES_MORE
    case "authorized":
      return PaymentSessionStatus.AUTHORIZED
    case "captured":
      return PaymentSessionStatus.CAPTURED
    case "canceled":
      return PaymentSessionStatus.CANCELED
    case "failed":
      return PaymentSessionStatus.ERROR
    case "partially_refunded":
    case "refunded":
      return PaymentSessionStatus.CAPTURED
    default:
      fail("unknown_provider_status", `Unknown Iyzico provider status: ${status}`)
  }
}

export function mapWebhookEvent(input: {
  event_id?: string
  provider_payment_id?: string
  checkout_form_token?: string
  provider_status?: string
}): IyzicoWebhookEvent {
  if (!input.event_id) fail("missing_event_id", "Webhook event id is required.")
  if (!input.provider_status) fail("missing_provider_status", "Webhook status is required.")
  const status = mapProviderStatus(input.provider_status)
  return {
    event_id: input.event_id,
    provider_payment_id: input.provider_payment_id,
    checkout_form_token: input.checkout_form_token,
    provider_status: input.provider_status as IyzicoProviderStatus,
    action: status,
  }
}

export function toPaymentAction(status: IyzicoProviderStatus): PaymentActions {
  switch (status) {
    case "authorized":
      return PaymentActions.AUTHORIZED
    case "captured":
      return PaymentActions.SUCCESSFUL
    case "failed":
      return PaymentActions.FAILED
    case "pending":
    case "initialized":
      return PaymentActions.PENDING
    case "requires_action":
      return PaymentActions.REQUIRES_MORE
    case "canceled":
      return PaymentActions.CANCELED
    case "partially_refunded":
    case "refunded":
      return PaymentActions.NOT_SUPPORTED
    default:
      return PaymentActions.NOT_SUPPORTED
  }
}

export function buildBasketPlan(input: {
  currency_code: string
  amount: unknown
  items: Array<{ id: string; name: string; amount: unknown }>
  shipping_amount?: unknown
}): IyzicoBasketPlan {
  const amount = assertTryPayment(input.currency_code, input.amount)
  const items = input.items.map((item) => ({
    id: item.id,
    name: maskText(item.name),
    amount: roundMoney(toNumberAmount(item.amount)),
  }))
  const shipping = roundMoney(toNumberAmount(input.shipping_amount ?? 0))
  const itemTotal = roundMoney(items.reduce((sum, item) => sum + item.amount, 0) + shipping)
  if (itemTotal !== amount) fail("basket_total_mismatch", "Basket item total plus shipping must equal payment amount.")
  return { currency_code: "try", amount, items, shipping_amount: shipping }
}

export function hasSensitiveValue(value: unknown): boolean {
  return /(\d{12,19}|cvv|cvc|card[_-]?number|secret|api[_-]?key)/i.test(JSON.stringify(value))
}

function roundMoney(n: number): number {
  if (!Number.isFinite(n) || n < 0) fail("invalid_money", "Invalid money value.")
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function maskText(v: string): string {
  return v.replace(/[\r\n\t]+/g, " ").slice(0, 120)
}
