import { MedusaContainer } from "@medusajs/framework/types"

export default async function scheduleCareReminders(_container: MedusaContainer) {
  // Future phase: derive hair-care reminders from consultations, orders, and usage cadence.
}

export const config = {
  name: "schedule-care-reminders",
  schedule: "0 9 * * *",
}
