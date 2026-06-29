import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

import {
  CUSTOMER_MESSAGING_AUTOMATION_MODULE,
} from "../modules/customer-messaging-automation"
import CustomerMessagingAutomationService from "../modules/customer-messaging-automation/service"

type OrderCanceledEvent = {
  id: string
}

/**
 * Sipariş iptal bildirimi event altyapısı (fail-safe).
 *
 * order.created abonesiyle aynı desen: alıcı çözümleme henüz bağlı olmadığından
 * gerçek e-posta GÖNDERMEZ; yalnız "skipped" event kaydeder. Mesaj sağlayıcısı
 * NullMessageProvider olduğundan test sırasında gerçek e-posta riski yoktur.
 */
export default async function orderCanceledMessageHandler({
  event: { data },
  container,
}: SubscriberArgs<OrderCanceledEvent>) {
  const messaging =
    container.resolve<CustomerMessagingAutomationService>(
      CUSTOMER_MESSAGING_AUTOMATION_MODULE
    )

  const templates = await messaging.listMessageTemplates({
    key: "order.canceled",
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
      source_event: "order.canceled",
      reason:
        "Order customer recipient resolution is not wired yet; no message was scheduled.",
      template_id: template.id,
    },
  })
}

export const config: SubscriberConfig = {
  event: "order.canceled",
}
