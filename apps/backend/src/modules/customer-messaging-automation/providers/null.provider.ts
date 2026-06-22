import { MessageProvider } from "./base"
import {
  MessageChannel,
  ProviderSendInput,
  ProviderSendResult,
} from "../types/messaging.types"

export class NullMessageProvider implements MessageProvider {
  readonly id: string

  constructor(readonly channel: MessageChannel) {
    this.id = `null_${channel}`
  }

  async send(input: ProviderSendInput): Promise<ProviderSendResult> {
    return {
      provider: this.id,
      providerMessageId: `null_${input.idempotencyKey}`,
      status: "sent",
      raw: {
        simulated: true,
        channel: input.channel,
        recipient: input.recipient,
      },
    }
  }
}
