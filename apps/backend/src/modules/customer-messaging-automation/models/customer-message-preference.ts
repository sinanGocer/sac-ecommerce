import { model } from "@medusajs/framework/utils"

const CustomerMessagePreference = model
  .define("customer_message_preference", {
    id: model.id({ prefix: "cmp" }).primaryKey(),
    customer_id: model.text().searchable(),
    email: model.text().nullable(),
    phone: model.text().nullable(),
    whatsapp_phone: model.text().nullable(),
    transactional_email_enabled: model.boolean().default(true),
    transactional_sms_enabled: model.boolean().default(true),
    transactional_whatsapp_enabled: model.boolean().default(true),
    marketing_email_opt_in: model.boolean().default(false),
    marketing_sms_opt_in: model.boolean().default(false),
    marketing_whatsapp_opt_in: model.boolean().default(false),
    care_reminder_email_opt_in: model.boolean().default(false),
    care_reminder_sms_opt_in: model.boolean().default(false),
    care_reminder_whatsapp_opt_in: model.boolean().default(false),
    appointment_email_opt_in: model.boolean().default(false),
    appointment_sms_opt_in: model.boolean().default(false),
    appointment_whatsapp_opt_in: model.boolean().default(false),
    opt_in_source: model.text().nullable(),
    opt_in_ip: model.text().nullable(),
    opt_in_user_agent: model.text().nullable(),
    opt_in_at: model.dateTime().nullable(),
    opt_out_at: model.dateTime().nullable(),
    kvkk_consent_version: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["customer_id"],
      unique: true,
    },
    {
      on: ["email"],
    },
    {
      on: ["phone"],
    },
  ])

export default CustomerMessagePreference
