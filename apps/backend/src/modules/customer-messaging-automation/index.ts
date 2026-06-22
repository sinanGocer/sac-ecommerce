import { Module } from "@medusajs/framework/utils"

import CustomerMessagingAutomationService from "./service"

export const CUSTOMER_MESSAGING_AUTOMATION_MODULE =
  "customerMessagingAutomation"

export default Module(CUSTOMER_MESSAGING_AUTOMATION_MODULE, {
  service: CustomerMessagingAutomationService,
})
