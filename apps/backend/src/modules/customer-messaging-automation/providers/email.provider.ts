import { MessageProvider } from "./base"
import { ProviderSendInput, ProviderSendResult } from "../types/messaging.types"

export class EmailMessageProvider implements MessageProvider {
  readonly id = "email_unconfigured"
  readonly channel = "email" as const

  async send(input: ProviderSendInput): Promise<ProviderSendResult> {
    return {
      provider: this.id,
      providerMessageId: null,
      status: "failed",
      error: `Email provider is not configured for ${input.recipient}.`,
    }
  }
}
