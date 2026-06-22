import { MessageProvider } from "./base"
import { ProviderSendInput, ProviderSendResult } from "../types/messaging.types"

export class SmsMessageProvider implements MessageProvider {
  readonly id = "sms_unconfigured"
  readonly channel = "sms" as const

  async send(input: ProviderSendInput): Promise<ProviderSendResult> {
    return {
      provider: this.id,
      providerMessageId: null,
      status: "failed",
      error: `SMS provider is not configured for ${input.recipient}.`,
    }
  }
}
