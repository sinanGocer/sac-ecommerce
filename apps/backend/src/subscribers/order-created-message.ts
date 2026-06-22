import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

import {
  CUSTOMER_MESSAGING_AUTOMATION_MODULE,
} from "../modules/customer-messaging-automation"
import CustomerMessagingAutomationService from "../modules/customer-messaging-automation/service"

type OrderCreatedEvent = {
  id: string
}

export default async function orderCreatedMessageHandler({
  event: { data },
  container,
}: SubscriberArgs<OrderCreatedEvent>) {
  const messaging =
    container.resolve<CustomerMessagingAutomationService>(
      CUSTOMER_MESSAGING_AUTOMATION_MODULE
    )

  const templates = await messaging.listMessageTemplates({
    key: "order.created",
    channel: "email",
    message_type: "transactional",
    is_active: true,
  })

  const template = templates[0]
  if (!template) return

  await messaging.recordMessageEvent({
    event_type: "skipped",
    data: {
      order_id: data.id,
      source_event: "order.created",
      reason:
        "Order customer recipient resolution is not wired yet; no message was scheduled.",
      template_id: template.id,
    },
  })
}

export const config: SubscriberConfig = {
  event: "order.created",
}
