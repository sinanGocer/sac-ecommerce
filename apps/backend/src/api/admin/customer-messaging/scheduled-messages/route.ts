import { MedusaRequest, MedusaResponse } from "@medusajs/framework"

import {
  CUSTOMER_MESSAGING_AUTOMATION_MODULE,
} from "../../../../modules/customer-messaging-automation"
import CustomerMessagingAutomationService from "../../../../modules/customer-messaging-automation/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const messaging =
    req.scope.resolve<CustomerMessagingAutomationService>(
      CUSTOMER_MESSAGING_AUTOMATION_MODULE
    )

  const messages = await messaging.listScheduledMessages({})

  res.json({ scheduled_messages: messages })
}
