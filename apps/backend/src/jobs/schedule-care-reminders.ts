import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Güvenlik bayrağı: Customer Messaging migration'ı uygulanana ve modül
 * açıkça etkinleştirilene kadar bu job HİÇBİR DB sorgusu yapmadan döner.
 * Varsayılan: kapalı (false).
 */
const CUSTOMER_MESSAGING_ENABLED =
  process.env.CUSTOMER_MESSAGING_ENABLED === "true"

export default async function scheduleCareReminders(container: MedusaContainer) {
  if (!CUSTOMER_MESSAGING_ENABLED) {
    container
      .resolve(ContainerRegistrationKeys.LOGGER)
      .info(
        "[schedule-care-reminders] CUSTOMER_MESSAGING_ENABLED!=true — atlandı (DB sorgusu yok)."
      )
    return
  }

  // Future phase: derive hair-care reminders from consultations, orders, and usage cadence.
}

export const config = {
  name: "schedule-care-reminders",
  schedule: "0 9 * * *",
}
