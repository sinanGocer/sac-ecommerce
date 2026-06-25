/**
 * Catalog pipeline lock — eşzamanlı GERÇEK commit pipeline'ını engeller.
 * Atomik dosya lock'u; ağır dependency/DB lock yok. Bu modül SAF kısımları
 * (serialize/parse/stale kararı) içerir; fs işlemleri script tarafındadır.
 *
 * FAIL-CLOSED stale kuralı:
 *  - PID canlı → yaşı ne olursa olsun lock AKTİF (silinemez).
 *  - PID durumu belirsiz → lock korunur (stale değil).
 *  - PID ölü VE TTL aşılmış → stale (geri alınabilir).
 *  - Bozuk lock → stale DEĞİL, otomatik silinmez (çağıran INVALID ile durur).
 */

export type PidStatus = "alive" | "dead" | "unknown"

export interface LockData {
  run_id: string
  pid: number
  started_at: string
  fingerprint: string
}

export type LockParse =
  | { kind: "valid"; data: LockData }
  | { kind: "invalid" }

export function serializeLock(data: LockData): string {
  return JSON.stringify(data, null, 2)
}

/** Bozuk/eksik/yanlış-tip → "invalid" (otomatik silinmez). */
export function parseLock(raw: string): LockParse {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: "invalid" }
  }
  if (!parsed || typeof parsed !== "object") return { kind: "invalid" }
  const o = parsed as Record<string, unknown>
  if (
    typeof o.run_id === "string" &&
    typeof o.pid === "number" &&
    Number.isInteger(o.pid) &&
    typeof o.started_at === "string" &&
    Number.isFinite(Date.parse(o.started_at)) &&
    typeof o.fingerprint === "string"
  ) {
    return {
      kind: "valid",
      data: {
        run_id: o.run_id,
        pid: o.pid,
        started_at: o.started_at,
        fingerprint: o.fingerprint,
      },
    }
  }
  return { kind: "invalid" }
}

/**
 * stale = SAHİBİ ÖLÜ **ve** TTL aşılmış. Canlı veya belirsiz PID → asla stale.
 */
export function isStaleLock(
  data: LockData,
  nowMs: number,
  staleMs: number,
  pidStatus: PidStatus
): boolean {
  if (pidStatus !== "dead") return false // canlı/belirsiz → fail-closed koru
  const started = Date.parse(data.started_at)
  if (!Number.isFinite(started)) return false // güvenli tarafta kal
  return nowMs - started > staleMs
}
