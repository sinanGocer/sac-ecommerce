import { model } from "@medusajs/framework/utils"

const MessageTemplate = model
  .define("message_template", {
    id: model.id({ prefix: "mtpl" }).primaryKey(),
    key: model.text().searchable(),
    channel: model.enum(["email", "sms", "whatsapp"]),
    message_type: model.enum([
      "transactional",
      "marketing",
      "care",
      "appointment",
    ]),
    locale: model.text().default("tr-TR"),
    subject: model.text().nullable(),
    body: model.text(),
    variables_schema: model.json().nullable(),
    is_active: model.boolean().default(true),
    version: model.number().default(1),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["key", "channel", "locale", "version"],
      unique: true,
    },
    {
      on: ["key", "channel", "locale"],
    },
  ])

export default MessageTemplate
