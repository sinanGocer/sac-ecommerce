export type MessageChannel = "email" | "sms" | "whatsapp"

export type MessageType =
  | "transactional"
  | "marketing"
  | "care"
  | "appointment"

export type ScheduledMessageStatus =
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  | "cancelled"
  | "skipped"

export type MessageEventType =
  | "queued"
  | "consent_checked"
  | "skipped"
  | "sent"
  | "failed"
  | "delivered"
  | "opened"
  | "clicked"
  | "opted_in"
  | "opted_out"

export type ProviderSendInput = {
  channel: MessageChannel
  messageType: MessageType
  recipient: string
  subject?: string | null
  body: string
  payload?: Record<string, unknown> | null
  idempotencyKey: string
}

export type ProviderSendResult = {
  provider: string
  providerMessageId: string | null
  status: "sent" | "failed"
  raw?: unknown
  error?: string
}

export type ScheduleMessageInput = {
  customer_id: string
  template_id: string
  channel: MessageChannel
  message_type: MessageType
  recipient: string
  scheduled_at: Date
  order_id?: string | null
  appointment_id?: string | null
  payload?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
  idempotency_key?: string | null
}

export type ConsentDecision = {
  allowed: boolean
  reason: string | null
}
