import { MedusaRequest, MedusaResponse } from "@medusajs/framework"

import {
  CUSTOMER_MESSAGING_AUTOMATION_MODULE,
} from "../../../../modules/customer-messaging-automation"
import CustomerMessagingAutomationService from "../../../../modules/customer-messaging-automation/service"
import { MessageChannel } from "../../../../modules/customer-messaging-automation/types/messaging.types"

type OptOutBody = {
  customer_id: string
  channel?: MessageChannel
}

export async function POST(req: MedusaRequest<OptOutBody>, res: MedusaResponse) {
  const messaging =
    req.scope.resolve<CustomerMessagingAutomationService>(
      CUSTOMER_MESSAGING_AUTOMATION_MODULE
    )

  const preference = await messaging.optOut(req.body.customer_id, req.body.channel)

  res.status(200).json({ preference })
}
