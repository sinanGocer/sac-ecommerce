import { fail } from "./errors"
import type {
  IyzicoCheckoutFormInitializeInput,
  IyzicoCheckoutFormInitializeOutput,
  IyzicoClient,
  IyzicoConfig,
  IyzicoWebhookVerificationInput,
} from "./types"

export class DisabledIyzicoClient implements IyzicoClient {
  constructor(private readonly config: IyzicoConfig) {}

  async initializeCheckoutForm(input: IyzicoCheckoutFormInitializeInput): Promise<IyzicoCheckoutFormInitializeOutput> {
    this.assertNoNetwork()
    return {
      status: "success",
      token: `fake_${input.idempotency_key.slice(0, 16)}`,
      payment_page_url: `https://sandbox.example.invalid/iyzico/${input.basket_id}`,
      provider_status: "requires_action",
    }
  }

  async retrieveCheckoutForm(token: string) {
    this.assertNoNetwork()
    return { provider_status: token.startsWith("fake_authorized") ? "authorized" as const : "requires_action" as const }
  }

  async retrievePayment(paymentId: string) {
    this.assertNoNetwork()
    return { provider_status: "pending" as const, provider_payment_id: paymentId }
  }

  async capturePayment(): Promise<{ provider_status: "authorized" }> {
    this.assertNoNetwork()
    fail("network_disabled", "Iyzico capture is disabled until real API transport is enabled.")
  }

  async cancelPayment(): Promise<{ provider_status: "canceled" }> {
    this.assertNoNetwork()
    fail("network_disabled", "Iyzico cancel is disabled until real API transport is enabled.")
  }

  async refundPayment(): Promise<{ provider_status: "refunded" }> {
    this.assertNoNetwork()
    fail("network_disabled", "Iyzico refund is disabled until real API transport is enabled.")
  }

  async verifyWebhookSignature(input: IyzicoWebhookVerificationInput): Promise<boolean> {
    if (!input.signature || !input.timestamp || !input.secret) return false
    return input.signature === "valid-test-signature"
  }

  private assertNoNetwork(): void {
    if (this.config.networkEnabled) {
      fail("transport_not_implemented", "Iyzico network transport is intentionally not implemented in this phase.")
    }
  }
}
