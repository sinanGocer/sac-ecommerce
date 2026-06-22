import {
  ConsentDecision,
  MessageChannel,
  MessageType,
} from "../types/messaging.types"

type PreferenceLike = {
  transactional_email_enabled?: boolean
  transactional_sms_enabled?: boolean
  transactional_whatsapp_enabled?: boolean
  marketing_email_opt_in?: boolean
  marketing_sms_opt_in?: boolean
  marketing_whatsapp_opt_in?: boolean
  care_reminder_email_opt_in?: boolean
  care_reminder_sms_opt_in?: boolean
  care_reminder_whatsapp_opt_in?: boolean
  appointment_email_opt_in?: boolean
  appointment_sms_opt_in?: boolean
  appointment_whatsapp_opt_in?: boolean
  opt_out_at?: Date | string | null
}

const consentField = (
  messageType: MessageType,
  channel: MessageChannel
): keyof PreferenceLike => {
  if (messageType === "transactional") {
    return `transactional_${channel}_enabled` as keyof PreferenceLike
  }

  if (messageType === "marketing") {
    return `marketing_${channel}_opt_in` as keyof PreferenceLike
  }

  if (messageType === "care") {
    return `care_reminder_${channel}_opt_in` as keyof PreferenceLike
  }

  return `appointment_${channel}_opt_in` as keyof PreferenceLike
}

export const evaluateConsent = (
  preferences: PreferenceLike | null | undefined,
  messageType: MessageType,
  channel: MessageChannel
): ConsentDecision => {
  if (!preferences) {
    return {
      allowed: messageType === "transactional",
      reason:
        messageType === "transactional"
          ? null
          : "Müşteri mesaj izni kaydı bulunamadı.",
    }
  }

  if (preferences.opt_out_at && messageType !== "transactional") {
    return {
      allowed: false,
      reason: "Müşteri pazarlama/bakım/randevu mesajlarından çıkış yapmış.",
    }
  }

  const field = consentField(messageType, channel)
  const allowed = preferences[field] === true

  return {
    allowed,
    reason: allowed
      ? null
      : `${messageType} mesajı için ${channel} açık rızası yok.`,
  }
}
