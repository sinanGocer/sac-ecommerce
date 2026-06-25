/**
 * Rapor tazeliği & doğru-rapor eşleştirmesi (SAF, fail-closed).
 *
 * Kör biçimde *-latest.json okumak yeterli değildir: rapor bu aşamada
 * yenilenmiş olmalı (kendi timestamp'i aşama started_at'inden yeni) VE mode/
 * scope (allowlist) ilgili aşamayla eşleşmeli. Aksi halde STALE_STAGE_REPORT.
 */

export interface FreshnessExpectation {
  field: string
  value: string | number | boolean
}

export interface FreshnessOptions {
  stageStartedAtMs: number
  /** raporun kendi zaman damgası alan(lar)ı (ilk bulunan kullanılır). */
  timestampFields: string[]
  /** mode/scope/allowlist eşleşmesi için beklenen alan=değerler. */
  expect: FreshnessExpectation[]
  /** saat yuvarlama toleransı (ms). */
  toleranceMs?: number
}

/** Dosya imzası — stage öncesi/sonrası karşılaştırması için (mtime+size). */
export interface FileSignature {
  exists: boolean
  mtimeMs: number
  size: number
}

/**
 * Dosya gerçekten değişti mi? Stage yeni rapor üretmediyse (mtime+size aynı)
 * → false. Aynı içerik tekrar yazılsa bile mtime ilerlemeliydi.
 */
export function fileChanged(
  before: FileSignature,
  after: FileSignature
): boolean {
  if (!after.exists) return false
  if (!before.exists) return true
  return after.mtimeMs > before.mtimeMs || after.size !== before.size
}

export function getPath(
  obj: Record<string, unknown> | null | undefined,
  path: string
): unknown {
  if (!obj) return undefined
  let cur: unknown = obj
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

export function checkReportFreshness(
  report: Record<string, unknown> | null,
  opts: FreshnessOptions
): { ok: boolean; reason: string | null } {
  if (!report) return { ok: false, reason: "no_report" }

  let ts: number | null = null
  for (const field of opts.timestampFields) {
    const raw = getPath(report, field)
    if (typeof raw === "string") {
      const parsed = Date.parse(raw)
      if (Number.isFinite(parsed)) {
        ts = parsed
        break
      }
    }
  }
  if (ts === null) return { ok: false, reason: "invalid_timestamp" }

  const tolerance = opts.toleranceMs ?? 2000
  if (ts < opts.stageStartedAtMs - tolerance) {
    return { ok: false, reason: "stale_report" }
  }

  for (const e of opts.expect) {
    if (getPath(report, e.field) !== e.value) {
      return { ok: false, reason: `scope_or_mode_mismatch:${e.field}` }
    }
  }
  return { ok: true, reason: null }
}
