import { MedusaService } from "@medusajs/framework/utils"

import CustomerMessagePreference from "./models/customer-message-preference"
import MessageEvent from "./models/message-event"
import MessageTemplate from "./models/message-template"
import ScheduledMessage from "./models/scheduled-message"
import { MessageProvider } from "./providers/base"
import { NullMessageProvider } from "./providers/null.provider"
import {
  MessageChannel,
  MessageEventType,
  MessageType,
  ScheduleMessageInput,
} from "./types/messaging.types"
import { evaluateConsent } from "./utils/consent-policy"
import { createMessageIdempotencyKey } from "./utils/idempotency"
import { renderTemplate } from "./utils/template-renderer"

type PreferenceUpdateInput = {
  customer_id: string
  email?: string | null
  phone?: string | null
  whatsapp_phone?: string | null
  transactional_email_enabled?: boolean
  transactional_sms_enabled?: boolean
  transactional_whatsapp_enabled?: boolean
  marketing_email_opt_in?: boolean
  marketing_sms_opt_in?: boolean
  marketing_whatsapp_opt_in?: boolean
  care_reminder_email_opt_in?: boolean
  care_reminder_sms_opt_in?: boolean
  care_reminder_whatsapp_opt_in?: boolean
  appointment_email_opt_in?: boolean
  appointment_sms_opt_in?: boolean
  appointment_whatsapp_opt_in?: boolean
  opt_in_source?: string | null
  opt_in_ip?: string | null
  opt_in_user_agent?: string | null
  kvkk_consent_version?: string | null
  metadata?: Record<string, unknown> | null
}

class CustomerMessagingAutomationService extends MedusaService({
  CustomerMessagePreference,
  MessageTemplate,
  ScheduledMessage,
  MessageEvent,
}) {
  private providers: Record<MessageChannel, MessageProvider>

  constructor(...args: any[]) {
    super(...args)

    this.providers = {
      email: new NullMessageProvider("email"),
      sms: new NullMessageProvider("sms"),
      whatsapp: new NullMessageProvider("whatsapp"),
    }
  }

  async getOrCreatePreferences(input: PreferenceUpdateInput) {
    const existing = await this.listCustomerMessagePreferences({
      customer_id: input.customer_id,
    })

    if (existing[0]) {
      return existing[0]
    }

    return this.createCustomerMessagePreferences({
      customer_id: input.customer_id,
      email: input.email ?? null,
      phone: input.phone ?? null,
      whatsapp_phone: input.whatsapp_phone ?? null,
      opt_in_source: input.opt_in_source ?? null,
      opt_in_ip: input.opt_in_ip ?? null,
      opt_in_user_agent: input.opt_in_user_agent ?? null,
      kvkk_consent_version: input.kvkk_consent_version ?? null,
      metadata: input.metadata ?? null,
    })
  }

  async updatePreferences(input: PreferenceUpdateInput) {
    const existing = await this.getOrCreatePreferences(input)
    const now = new Date()
    const hasOptIn = [
      input.marketing_email_opt_in,
      input.marketing_sms_opt_in,
      input.marketing_whatsapp_opt_in,
      input.care_reminder_email_opt_in,
      input.care_reminder_sms_opt_in,
      input.care_reminder_whatsapp_opt_in,
      input.appointment_email_opt_in,
      input.appointment_sms_opt_in,
      input.appointment_whatsapp_opt_in,
    ].some((value) => value === true)

    const updates = {
      id: existing.id,
      ...input,
      opt_in_at: hasOptIn ? now : existing.opt_in_at,
      opt_out_at: hasOptIn ? null : existing.opt_out_at,
    }

    const [updated] = await this.updateCustomerMessagePreferences([updates])

    await this.recordMessageEvent({
      customer_id: input.customer_id,
      event_type: hasOptIn ? "opted_in" : "consent_checked",
      data: {
        source: input.opt_in_source ?? null,
        kvkk_consent_version: input.kvkk_consent_version ?? null,
      },
    })

    return updated
  }

  async optOut(customerId: string, channel?: MessageChannel) {
    const preferences = await this.getOrCreatePreferences({ customer_id: customerId })
    const channelUpdates = channel
      ? this.optOutFieldsForChannel(channel)
      : {
          marketing_email_opt_in: false,
          marketing_sms_opt_in: false,
          marketing_whatsapp_opt_in: false,
          care_reminder_email_opt_in: false,
          care_reminder_sms_opt_in: false,
          care_reminder_whatsapp_opt_in: false,
          appointment_email_opt_in: false,
          appointment_sms_opt_in: false,
          appointment_whatsapp_opt_in: false,
        }

    const [updated] = await this.updateCustomerMessagePreferences([
      {
        id: preferences.id,
        ...channelUpdates,
        opt_out_at: new Date(),
      },
    ])

    await this.recordMessageEvent({
      customer_id: customerId,
      event_type: "opted_out",
      channel,
      data: { channel: channel ?? "all" },
    })

    return updated
  }

  async scheduleMessage(input: ScheduleMessageInput) {
    const preferences = await this.getOrCreatePreferences({
      customer_id: input.customer_id,
    })
    const consent = evaluateConsent(
      preferences,
      input.message_type,
      input.channel
    )
    const idempotencyKey =
      input.idempotency_key ??
      createMessageIdempotencyKey([
        input.customer_id,
        input.order_id,
        input.appointment_id,
        input.template_id,
        input.channel,
        input.message_type,
        input.scheduled_at.toISOString(),
      ])

    const message = await this.createScheduledMessages({
      customer_id: input.customer_id,
      order_id: input.order_id ?? null,
      appointment_id: input.appointment_id ?? null,
      template_id: input.template_id,
      channel: input.channel,
      message_type: input.message_type,
      recipient: input.recipient,
      payload: input.payload ?? null,
      scheduled_at: input.scheduled_at,
      status: consent.allowed ? "pending" : "skipped",
      skip_reason: consent.reason,
      retry_count: 0,
      idempotency_key: idempotencyKey,
      metadata: input.metadata ?? null,
    })

    await this.recordMessageEvent({
      scheduled_message_id: message.id,
      customer_id: input.customer_id,
      event_type: consent.allowed ? "queued" : "skipped",
      channel: input.channel,
      data: {
        message_type: input.message_type,
        consent,
      },
    })

    return message
  }

  async processDueMessages(now = new Date(), limit = 50) {
    const pending = await this.listScheduledMessages(
      {
        status: "pending",
        scheduled_at: { $lte: now },
      },
      {
        take: limit,
        order: { scheduled_at: "ASC" },
      }
    )

    const results = []

    for (const message of pending) {
      results.push(await this.sendScheduledMessage(message.id))
    }

    return results
  }

  async sendScheduledMessage(id: string) {
    const message = await this.retrieveScheduledMessage(id)
    const template = await this.retrieveMessageTemplate(message.template_id)
    const provider = this.providers[message.channel as MessageChannel]

    await this.updateScheduledMessages([
      {
        id: message.id,
        status: "processing",
      },
    ])

    const payload = (message.payload ?? {}) as Record<string, unknown>
    const result = await provider.send({
      channel: message.channel as MessageChannel,
      messageType: message.message_type as MessageType,
      recipient: message.recipient,
      subject: renderTemplate(template.subject, payload),
      body: renderTemplate(template.body, payload) ?? "",
      payload,
      idempotencyKey: message.idempotency_key,
    })

    if (result.status === "sent") {
      const [updated] = await this.updateScheduledMessages([
        {
          id: message.id,
          status: "sent",
          sent_at: new Date(),
          provider: result.provider,
          provider_message_id: result.providerMessageId,
        },
      ])

      await this.recordMessageEvent({
        scheduled_message_id: message.id,
        customer_id: message.customer_id,
        event_type: "sent",
        channel: message.channel as MessageChannel,
        provider: result.provider,
        data: result.raw as Record<string, unknown>,
      })

      return updated
    }

    const [updated] = await this.updateScheduledMessages([
      {
        id: message.id,
        status: "failed",
        provider: result.provider,
        failure_reason: result.error ?? "Provider gönderimi başarısız.",
        retry_count: (message.retry_count ?? 0) + 1,
      },
    ])

    await this.recordMessageEvent({
      scheduled_message_id: message.id,
      customer_id: message.customer_id,
      event_type: "failed",
      channel: message.channel as MessageChannel,
      provider: result.provider,
      data: {
        error: result.error,
        raw: result.raw,
      },
    })

    return updated
  }

  async recordMessageEvent(input: {
    scheduled_message_id?: string | null
    customer_id?: string | null
    event_type: MessageEventType
    channel?: MessageChannel | null
    provider?: string | null
    provider_event_id?: string | null
    data?: Record<string, unknown> | null
  }) {
    return this.createMessageEvents({
      scheduled_message_id: input.scheduled_message_id ?? null,
      customer_id: input.customer_id ?? null,
      event_type: input.event_type,
      channel: input.channel ?? null,
      provider: input.provider ?? null,
      provider_event_id: input.provider_event_id ?? null,
      data: input.data ?? null,
    })
  }

  private optOutFieldsForChannel(channel: MessageChannel) {
    return {
      [`marketing_${channel}_opt_in`]: false,
      [`care_reminder_${channel}_opt_in`]: false,
      [`appointment_${channel}_opt_in`]: false,
    }
  }
}

export default CustomerMessagingAutomationService
