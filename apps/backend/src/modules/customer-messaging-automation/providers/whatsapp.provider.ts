import { MessageProvider } from "./base"
import { ProviderSendInput, ProviderSendResult } from "../types/messaging.types"

export class WhatsappMessageProvider implements MessageProvider {
  readonly id = "whatsapp_unconfigured"
  readonly channel = "whatsapp" as const

  async send(input: ProviderSendInput): Promise<ProviderSendResult> {
    return {
      provider: this.id,
      providerMessageId: null,
      status: "failed",
      error: `WhatsApp provider is not configured for ${input.recipient}.`,
    }
  }
}
