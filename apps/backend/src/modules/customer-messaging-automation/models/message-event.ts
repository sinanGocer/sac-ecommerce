import { model } from "@medusajs/framework/utils"

const MessageEvent = model
  .define("message_event", {
    id: model.id({ prefix: "mevt" }).primaryKey(),
    scheduled_message_id: model.text().nullable(),
    customer_id: model.text().nullable(),
    event_type: model.enum([
      "queued",
      "consent_checked",
      "skipped",
      "sent",
      "failed",
      "delivered",
      "opened",
      "clicked",
      "opted_in",
      "opted_out",
    ]),
    channel: model.enum(["email", "sms", "whatsapp"]).nullable(),
    provider: model.text().nullable(),
    provider_event_id: model.text().nullable(),
    data: model.json().nullable(),
  })
  .indexes([
    {
      on: ["scheduled_message_id"],
    },
    {
      on: ["customer_id"],
    },
    {
      on: ["event_type"],
    },
  ])

export default MessageEvent
