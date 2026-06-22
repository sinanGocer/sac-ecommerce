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

  const preferences = await messaging.listCustomerMessagePreferences({})

  res.json({ preferences })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const messaging =
    req.scope.resolve<CustomerMessagingAutomationService>(
      CUSTOMER_MESSAGING_AUTOMATION_MODULE
    )

  const preference = await messaging.updatePreferences(req.body as never)

  res.status(200).json({ preference })
}
