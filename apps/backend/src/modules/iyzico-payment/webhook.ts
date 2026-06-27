import { PaymentActions } from "@medusajs/framework/utils"

import type { IyzicoClient, IyzicoWebhookEvent, IyzicoWebhookVerificationInput } from "./types"
import { mapWebhookEvent } from "./mapper"

export type IyzicoWebhookBoundaryResult =
  | { decision: "WEBHOOK_BLOCKED"; reason: string; db_writes: 0 }
  | { decision: "WEBHOOK_DUPLICATE"; event_id: string; db_writes: 0 }
  | { decision: "WEBHOOK_NORMALIZED"; event: IyzicoWebhookEvent; action: PaymentActions; db_writes: 0 }

export async function handleIyzicoWebhookBoundary(input: IyzicoWebhookVerificationInput & {
  client: IyzicoClient
  seenEventIds?: Set<string>
  now?: number
  replayWindowMs?: number
}): Promise<IyzicoWebhookBoundaryResult> {
  if (!input.signature) return { decision: "WEBHOOK_BLOCKED", reason: "missing_signature", db_writes: 0 }
  if (!input.timestamp) return { decision: "WEBHOOK_BLOCKED", reason: "missing_timestamp", db_writes: 0 }
  const ts = Number(input.timestamp)
  if (!Number.isFinite(ts)) return { decision: "WEBHOOK_BLOCKED", reason: "invalid_timestamp", db_writes: 0 }
  const now = input.now ?? Date.now()
  const windowMs = input.replayWindowMs ?? 5 * 60 * 1000
  if (Math.abs(now - ts) > windowMs) return { decision: "WEBHOOK_BLOCKED", reason: "stale_timestamp", db_writes: 0 }
  const ok = await input.client.verifyWebhookSignature(input)
  if (!ok) return { decision: "WEBHOOK_BLOCKED", reason: "invalid_signature", db_writes: 0 }

  let body: unknown
  try {
    body = JSON.parse(input.rawBody)
  } catch {
    return { decision: "WEBHOOK_BLOCKED", reason: "invalid_json", db_writes: 0 }
  }
  const event = mapWebhookEvent(body as Record<string, unknown>)
  if (input.seenEventIds?.has(event.event_id)) return { decision: "WEBHOOK_DUPLICATE", event_id: event.event_id, db_writes: 0 }
  return { decision: "WEBHOOK_NORMALIZED", event, action: PaymentActions.NOT_SUPPORTED, db_writes: 0 }
}
