import { model } from "@medusajs/framework/utils"

const ScheduledMessage = model
  .define("scheduled_message", {
    id: model.id({ prefix: "smsg" }).primaryKey(),
    customer_id: model.text().searchable(),
    order_id: model.text().nullable(),
    appointment_id: model.text().nullable(),
    template_id: model.text(),
    channel: model.enum(["email", "sms", "whatsapp"]),
    message_type: model.enum([
      "transactional",
      "marketing",
      "care",
      "appointment",
    ]),
    recipient: model.text().searchable(),
    payload: model.json().nullable(),
    scheduled_at: model.dateTime(),
    sent_at: model.dateTime().nullable(),
    status: model
      .enum([
        "pending",
        "processing",
        "sent",
        "failed",
        "cancelled",
        "skipped",
      ])
      .default("pending"),
    skip_reason: model.text().nullable(),
    failure_reason: model.text().nullable(),
    provider: model.text().nullable(),
    provider_message_id: model.text().nullable(),
    retry_count: model.number().default(0),
    idempotency_key: model.text().unique(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["status", "scheduled_at"],
    },
    {
      on: ["customer_id"],
    },
    {
      on: ["order_id"],
    },
  ])

export default ScheduledMessage
