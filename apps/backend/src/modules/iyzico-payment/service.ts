import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import { AbstractPaymentProvider, PaymentActions, PaymentSessionStatus } from "@medusajs/framework/utils"

import { DisabledIyzicoClient } from "./client"
import { parseIyzicoConfig } from "./config"
import { fail } from "./errors"
import {
  assertTryPayment,
  buildInitialSessionData,
  deterministicIdempotencyKey,
  hasSensitiveValue,
  mapProviderStatus,
  parseSessionData,
  toPaymentAction,
} from "./mapper"
import type { IyzicoClient, IyzicoConfig, IyzicoProviderOptions } from "./types"

export default class IyzicoPaymentProviderService extends AbstractPaymentProvider<IyzicoProviderOptions> {
  static identifier = "iyzico"

  protected readonly config_: IyzicoConfig
  protected readonly client_: IyzicoClient

  static validateOptions(options: IyzicoProviderOptions): void {
    parseIyzicoConfig(options)
  }

  constructor(cradle: Record<string, unknown>, options: IyzicoProviderOptions) {
    super(cradle, options)
    this.config_ = parseIyzicoConfig(options)
    this.client_ = new DisabledIyzicoClient(this.config_)
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const amount = assertTryPayment(input.currency_code, input.amount, this.config_.maxSandboxAmount)
    const idempotencyKey = deterministicIdempotencyKey([
      "iyzico",
      this.config_.mode,
      input.currency_code.toLowerCase(),
      amount,
      input.context?.idempotency_key,
    ])
    const basketId = `basket_${idempotencyKey.slice(0, 16)}`
    const response = await this.client_.initializeCheckoutForm({
      amount,
      currency_code: "try",
      basket_id: basketId,
      conversation_id: idempotencyKey,
      callback_url: this.config_.callbackUrl,
      return_url: this.config_.returnUrl,
      idempotency_key: idempotencyKey,
    })
    const data = buildInitialSessionData({
      mode: this.config_.mode,
      amount,
      currency_code: "try",
      idempotency_key: idempotencyKey,
      checkout_form_token: response.token,
      payment_page_url: response.payment_page_url,
    })
    return { id: data.conversation_id, status: PaymentSessionStatus.REQUIRES_MORE, data }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const existing = input.data ? parseSessionData(input.data) : null
    const amount = assertTryPayment(input.currency_code, input.amount, this.config_.maxSandboxAmount)
    if (existing?.authorized_at) fail("stale_authorized_session", "Authorized Iyzico sessions cannot be updated.")
    return { status: PaymentSessionStatus.REQUIRES_MORE, data: { ...(existing ?? {}), updated_amount: amount } }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    const existing = input.data ? parseSessionData(input.data) : null
    return { data: { ...(existing ?? {}), deleted_locally: true } }
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const existing = parseSessionData(input.data)
    if (!existing.checkout_form_token && !existing.provider_payment_id) {
      fail("authorization_evidence_missing", "Iyzico authorization requires verified provider evidence.")
    }
    const status = mapProviderStatus(existing.provider_status ?? "requires_action")
    if (status !== PaymentSessionStatus.AUTHORIZED && status !== PaymentSessionStatus.REQUIRES_MORE) {
      fail("authorization_not_successful", "Iyzico provider status is not authorizable.")
    }
    return {
      status,
      data: {
        ...existing,
        authorized_at: status === PaymentSessionStatus.AUTHORIZED ? new Date(0).toISOString() : existing.authorized_at,
      },
    }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    const existing = parseSessionData(input.data)
    if (existing.captured_at) fail("duplicate_capture", "Iyzico payment was already captured.")
    if (existing.provider_status !== "authorized") fail("capture_not_authorized", "Only authorized Iyzico payments can be captured.")
    fail("network_disabled", "Iyzico capture is disabled in skeleton phase.")
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const existing = parseSessionData(input.data)
    const amount = assertTryPayment("try", input.amount, this.config_.maxSandboxAmount)
    if (!existing.captured_at && existing.provider_status !== "captured") fail("refund_without_capture", "Cannot refund an uncaptured Iyzico payment.")
    const captured = existing.captured_amount ?? 0
    const refunded = existing.refunded_amount ?? 0
    if (amount + refunded > captured) fail("over_refund", "Refund amount exceeds captured amount.")
    fail("network_disabled", "Iyzico refund is disabled in skeleton phase.")
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const existing = input.data ? parseSessionData(input.data) : null
    return { data: { ...(existing ?? {}), provider: "iyzico" } }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const existing = parseSessionData(input.data)
    if (existing.captured_at || existing.provider_status === "captured") fail("cancel_after_capture", "Captured Iyzico payments must use refund.")
    fail("network_disabled", "Iyzico cancel is disabled in skeleton phase.")
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const existing = parseSessionData(input.data)
    return { status: mapProviderStatus(existing.provider_status ?? "requires_action"), data: existing }
  }

  async getWebhookActionAndData(data: ProviderWebhookPayload["payload"]): Promise<WebhookActionResult> {
    if (hasSensitiveValue(data)) fail("sensitive_webhook_payload", "Webhook payload contains sensitive-looking data.")
    const status = typeof data === "object" && data && "provider_status" in data ? String((data as Record<string, unknown>).provider_status) : "unknown"
    const action = toPaymentAction(status as never)
    return { action }
  }
}
