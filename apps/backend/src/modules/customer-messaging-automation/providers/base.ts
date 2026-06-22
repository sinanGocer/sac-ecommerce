import {
  MessageChannel,
  ProviderSendInput,
  ProviderSendResult,
} from "../types/messaging.types"

export interface MessageProvider {
  readonly id: string
  readonly channel: MessageChannel
  send(input: ProviderSendInput): Promise<ProviderSendResult>
}
