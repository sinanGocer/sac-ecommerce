import { MedusaContainer } from "@medusajs/framework/types"

import {
  CUSTOMER_MESSAGING_AUTOMATION_MODULE,
} from "../modules/customer-messaging-automation"
import CustomerMessagingAutomationService from "../modules/customer-messaging-automation/service"

export default async function processScheduledMessages(container: MedusaContainer) {
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
