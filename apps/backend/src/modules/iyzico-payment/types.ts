import type { PaymentSessionStatus } from "@medusajs/framework/types"

export const IYZICO_PROVIDER_IDENTIFIER = "iyzico"
export const IYZICO_PROVIDER_ID = "pp_iyzico_iyzico"

export type IyzicoMode = "sandbox" | "production"

export type IyzicoProviderStatus =
  | "initialized"
  | "pending"
  | "requires_action"
  | "authorized"
  | "captured"
  | "canceled"
  | "failed"
  | "partially_refunded"
  | "refunded"

export interface IyzicoProviderOptions {
  mode?: string
  apiKey?: string
  secretKey?: string
  baseUrl?: string
  callbackUrl?: string
  returnUrl?: string
  webhookSecret?: string
  networkEnabled?: string | boolean
  maxSandboxAmount?: number
}

export interface IyzicoConfig {
  mode: IyzicoMode
  apiKey: string
  secretKey: string
  baseUrl: string
  callbackUrl: string
  returnUrl: string
  webhookSecret?: string
  networkEnabled: boolean
  maxSandboxAmount: number
}

export interface IyzicoPaymentSessionData extends Record<string, unknown> {
  provider: "iyzico"
  mode: IyzicoMode
  conversation_id: string
  basket_id: string
  checkout_form_token?: string
  payment_page_url?: string
  provider_payment_id?: string
  provider_status?: IyzicoProviderStatus
  idempotency_key: string
  initialized_at?: string
  authorized_at?: string
  captured_at?: string
  canceled_at?: string
  refunded_amount?: number
  captured_amount?: number
}

export interface IyzicoCheckoutFormInitializeInput {
  amount: number
  currency_code: "try"
  basket_id: string
  conversation_id: string
  callback_url: string
  return_url: string
  idempotency_key: string
}

export interface IyzicoCheckoutFormInitializeOutput {
  status: "success" | "failure"
  token?: string
  payment_page_url?: string
  provider_status: IyzicoProviderStatus
  provider_payment_id?: string
}

export interface IyzicoClient {
  initializeCheckoutForm(input: IyzicoCheckoutFormInitializeInput): Promise<IyzicoCheckoutFormInitializeOutput>
  retrieveCheckoutForm(token: string): Promise<{ provider_status: IyzicoProviderStatus; provider_payment_id?: string }>
  retrievePayment(paymentId: string): Promise<{ provider_status: IyzicoProviderStatus; provider_payment_id: string }>
  capturePayment(paymentId: string): Promise<{ provider_status: IyzicoProviderStatus }>
  cancelPayment(paymentId: string): Promise<{ provider_status: IyzicoProviderStatus }>
  refundPayment(paymentId: string, amount: number): Promise<{ provider_status: IyzicoProviderStatus }>
  verifyWebhookSignature(input: IyzicoWebhookVerificationInput): Promise<boolean>
}

export interface IyzicoWebhookVerificationInput {
  rawBody: string
  signature?: string | null
  timestamp?: string | null
  secret?: string | null
}

export interface IyzicoWebhookEvent {
  event_id: string
  provider_payment_id?: string
  checkout_form_token?: string
  provider_status: IyzicoProviderStatus
  action: PaymentSessionStatus | "not_supported"
}

export interface IyzicoBasketItem {
  id: string
  name: string
  amount: number
}

export interface IyzicoBasketPlan {
  currency_code: "try"
  amount: number
  items: IyzicoBasketItem[]
  shipping_amount: number
}
