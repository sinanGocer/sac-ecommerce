import { createHash } from "crypto"

export const createMessageIdempotencyKey = (parts: Array<string | null | undefined>) =>
  createHash("sha256")
    .update(parts.filter(Boolean).join("|"))
    .digest("hex")
