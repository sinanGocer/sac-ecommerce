import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  CUSTOMER_MESSAGING_AUTOMATION_MODULE,
} from "../modules/customer-messaging-automation"
import CustomerMessagingAutomationService from "../modules/customer-messaging-automation/service"

/**
 * Güvenlik bayrağı: Customer Messaging migration'ı uygulanana ve modül
 * açıkça etkinleştirilene kadar bu job HİÇBİR DB sorgusu yapmadan döner.
 * Varsayılan: kapalı (false).
 */
const CUSTOMER_MESSAGING_ENABLED =
  process.env.CUSTOMER_MESSAGING_ENABLED === "true"

export default async function processScheduledMessages(container: MedusaContainer) {
  if (!CUSTOMER_MESSAGING_ENABLED) {
    container
      .resolve(ContainerRegistrationKeys.LOGGER)
      .info(
        "[process-scheduled-customer-messages] CUSTOMER_MESSAGING_ENABLED!=true — atlandı (DB sorgusu yok)."
      )
    return
  }

  const messaging =
    container.resolve<CustomerMessagingAutomationService>(
      CUSTOMER_MESSAGING_AUTOMATION_MODULE
    )

  await messaging.processDueMessages(new Date(), 50)
}

export const config = {
  name: "process-scheduled-customer-messages",
  schedule: "* * * * *",
}
