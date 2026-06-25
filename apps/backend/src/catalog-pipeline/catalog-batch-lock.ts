import { promises as fs } from "fs"
import path from "path"

/**
 * Catalog pipeline lock — race-safe stale takeover.
 *
 * Ana lock doğrudan yalnız boş path üzerinde "wx" ile alınır. Stale ana lock
 * recovery'si ise ikinci bir atomik recovery mutex'i altında yapılır; recovery
 * mutex alındıktan sonra ana lock identity ve stale durumu yeniden doğrulanır.
 */

export type PidStatus = "alive" | "dead" | "unknown"

export interface PipelineLock {
  run_id: string
  pid: number
  started_at: string
  fingerprint: string
}

/** Eski importları kırmamak için aynı sözleşmenin adı korunur. */
export type LockData = PipelineLock

export interface PipelineRecoveryLock extends PipelineLock {
  target_lock_identity: string
}

export interface PipelineLockPaths {
  lockPath: string
  recoveryPath: string
}

export type PipelineLockAcquireResult =
  | {
      ok: true
      lock: PipelineLock
      recovered_stale_lock: boolean
    }
  | {
      ok: false
      decision: "PIPELINE_ALREADY_RUNNING" | "PIPELINE_INVALID_LOCK"
      reason: string
    }

export interface PipelineLockHooks {
  afterInitialLockRead?: (lock: PipelineLock) => Promise<void>
  afterRecoveryMutexAcquired?: (
    recovery: PipelineRecoveryLock
  ) => Promise<void>
  afterMainLockRemoved?: () => Promise<void>
}

export interface AcquirePipelineLockOptions {
  paths: PipelineLockPaths
  lock: PipelineLock
  lockStaleMs: number
  recoveryStaleMs: number
  nowMs?: () => number
  getPidStatus?: (pid: number) => PidStatus
  hooks?: PipelineLockHooks
}

export type LockParse =
  | { kind: "valid"; data: PipelineLock }
  | { kind: "invalid" }

export type RecoveryLockParse =
  | { kind: "valid"; data: PipelineRecoveryLock }
  | { kind: "invalid" }

export function serializeLock(data: PipelineLock): string {
  return JSON.stringify(data, null, 2)
}

export function serializeRecoveryLock(data: PipelineRecoveryLock): string {
  return JSON.stringify(data, null, 2)
}

/** Bozuk/eksik/yanlış-tip → invalid; otomatik silinmez. */
export function parseLock(raw: string): LockParse {
  const base = parseBaseLock(raw)
  return base ? { kind: "valid", data: base } : { kind: "invalid" }
}

export function parseRecoveryLock(raw: string): RecoveryLockParse {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: "invalid" }
  }
  if (!parsed || typeof parsed !== "object") return { kind: "invalid" }
  const base = parseBaseLockObject(parsed as Record<string, unknown>)
  const target = (parsed as Record<string, unknown>).target_lock_identity
  if (!base || typeof target !== "string" || target.length === 0) {
    return { kind: "invalid" }
  }
  return {
    kind: "valid",
    data: { ...base, target_lock_identity: target },
  }
}

export function lockIdentity(lock: PipelineLock): string {
  return [
    lock.run_id,
    lock.pid,
    lock.started_at,
    lock.fingerprint,
  ].join(":")
}

/**
 * stale = sahibi kesin ölü VE TTL aşılmış.
 * Canlı/belirsiz PID veya geçersiz tarih fail-closed korunur.
 */
export function isStaleLock(
  data: PipelineLock,
  nowMs: number,
  staleMs: number,
  pidStatus: PidStatus
): boolean {
  if (pidStatus !== "dead") return false
  const started = Date.parse(data.started_at)
  if (!Number.isFinite(started)) return false
  return nowMs - started > staleMs
}

export async function acquirePipelineLock(
  options: AcquirePipelineLockOptions
): Promise<PipelineLockAcquireResult> {
  const nowMs = options.nowMs ?? Date.now
  const getPidStatus = options.getPidStatus ?? processPidStatus
  await fs.mkdir(path.dirname(options.paths.lockPath), { recursive: true })

  if (await writeExclusive(options.paths.lockPath, serializeLock(options.lock))) {
    return {
      ok: true,
      lock: options.lock,
      recovered_stale_lock: false,
    }
  }

  const initial = await readMainLock(options.paths.lockPath)
  if (initial.kind === "missing") {
    if (await writeExclusive(options.paths.lockPath, serializeLock(options.lock))) {
      return {
        ok: true,
        lock: options.lock,
        recovered_stale_lock: false,
      }
    }
    return alreadyRunning("main_lock_changed_before_recovery")
  }
  if (initial.kind === "invalid") {
    return invalidLock("main_lock_invalid")
  }

  await options.hooks?.afterInitialLockRead?.(initial.data)

  if (
    !isStaleLock(
      initial.data,
      nowMs(),
      options.lockStaleMs,
      getPidStatus(initial.data.pid)
    )
  ) {
    return alreadyRunning("main_lock_not_stale")
  }

  const recoveryOwner: PipelineRecoveryLock = {
    ...options.lock,
    target_lock_identity: lockIdentity(initial.data),
  }
  const recovery = await acquireRecoveryMutex(
    options.paths.recoveryPath,
    recoveryOwner,
    options.recoveryStaleMs,
    nowMs,
    getPidStatus
  )
  if (!recovery.ok) return recovery

  try {
    await options.hooks?.afterRecoveryMutexAcquired?.(recoveryOwner)

    const current = await readMainLock(options.paths.lockPath)
    if (current.kind === "invalid") return invalidLock("main_lock_invalid")
    if (current.kind === "missing") {
      return alreadyRunning("main_lock_changed_during_recovery")
    }
    if (lockIdentity(current.data) !== recoveryOwner.target_lock_identity) {
      return alreadyRunning("main_lock_identity_changed")
    }
    if (
      !isStaleLock(
        current.data,
        nowMs(),
        options.lockStaleMs,
        getPidStatus(current.data.pid)
      )
    ) {
      return alreadyRunning("main_lock_no_longer_stale")
    }

    await fs.unlink(options.paths.lockPath)
    await options.hooks?.afterMainLockRemoved?.()

    if (!(await writeExclusive(options.paths.lockPath, serializeLock(options.lock)))) {
      return alreadyRunning("main_lock_acquired_by_another_run")
    }
    return {
      ok: true,
      lock: options.lock,
      recovered_stale_lock: true,
    }
  } finally {
    await releaseRecoveryMutex(options.paths.recoveryPath, recoveryOwner)
  }
}

export async function releasePipelineLock(
  lockPath: string,
  owner: PipelineLock
): Promise<boolean> {
  const current = await readMainLock(lockPath)
  if (
    current.kind !== "valid" ||
    !sameOwner(current.data, owner)
  ) {
    return false
  }
  return unlinkIfPresent(lockPath)
}

export async function releaseRecoveryMutex(
  recoveryPath: string,
  owner: PipelineRecoveryLock
): Promise<boolean> {
  const current = await readRecoveryLock(recoveryPath)
  if (
    current.kind !== "valid" ||
    !sameOwner(current.data, owner)
  ) {
    return false
  }
  return unlinkIfPresent(recoveryPath)
}

function parseBaseLock(raw: string): PipelineLock | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  return parsed && typeof parsed === "object"
    ? parseBaseLockObject(parsed as Record<string, unknown>)
    : null
}

function parseBaseLockObject(o: Record<string, unknown>): PipelineLock | null {
  if (
    typeof o.run_id !== "string" ||
    o.run_id.length === 0 ||
    typeof o.pid !== "number" ||
    !Number.isInteger(o.pid) ||
    typeof o.started_at !== "string" ||
    !Number.isFinite(Date.parse(o.started_at)) ||
    typeof o.fingerprint !== "string" ||
    o.fingerprint.length === 0
  ) {
    return null
  }
  return {
    run_id: o.run_id,
    pid: o.pid,
    started_at: o.started_at,
    fingerprint: o.fingerprint,
  }
}

type ReadLockResult<T> =
  | { kind: "valid"; data: T }
  | { kind: "invalid" }
  | { kind: "missing" }

async function readMainLock(
  lockPath: string
): Promise<ReadLockResult<PipelineLock>> {
  const raw = await readFileIfPresent(lockPath)
  if (raw === null) return { kind: "missing" }
  const parsed = parseLock(raw)
  return parsed.kind === "valid"
    ? parsed
    : { kind: "invalid" }
}

async function readRecoveryLock(
  recoveryPath: string
): Promise<ReadLockResult<PipelineRecoveryLock>> {
  const raw = await readFileIfPresent(recoveryPath)
  if (raw === null) return { kind: "missing" }
  const parsed = parseRecoveryLock(raw)
  return parsed.kind === "valid"
    ? parsed
    : { kind: "invalid" }
}

async function acquireRecoveryMutex(
  recoveryPath: string,
  owner: PipelineRecoveryLock,
  staleMs: number,
  nowMs: () => number,
  getPidStatus: (pid: number) => PidStatus
): Promise<PipelineLockAcquireResult> {
  if (await writeExclusive(recoveryPath, serializeRecoveryLock(owner))) {
    return { ok: true, lock: owner, recovered_stale_lock: false }
  }

  const initial = await readRecoveryLock(recoveryPath)
  if (initial.kind === "missing") {
    if (await writeExclusive(recoveryPath, serializeRecoveryLock(owner))) {
      return { ok: true, lock: owner, recovered_stale_lock: false }
    }
    return alreadyRunning("recovery_mutex_contended")
  }
  if (initial.kind === "invalid") {
    return invalidLock("recovery_mutex_invalid")
  }
  if (
    !isStaleLock(
      initial.data,
      nowMs(),
      staleMs,
      getPidStatus(initial.data.pid)
    )
  ) {
    return alreadyRunning("recovery_mutex_busy")
  }

  const current = await readRecoveryLock(recoveryPath)
  if (current.kind === "invalid") return invalidLock("recovery_mutex_invalid")
  if (
    current.kind !== "valid" ||
    lockIdentity(current.data) !== lockIdentity(initial.data) ||
    !isStaleLock(
      current.data,
      nowMs(),
      staleMs,
      getPidStatus(current.data.pid)
    )
  ) {
    return alreadyRunning("recovery_mutex_changed")
  }

  await fs.unlink(recoveryPath)
  if (!(await writeExclusive(recoveryPath, serializeRecoveryLock(owner)))) {
    return alreadyRunning("recovery_mutex_acquired_by_another_run")
  }
  return { ok: true, lock: owner, recovered_stale_lock: true }
}

async function writeExclusive(filePath: string, content: string): Promise<boolean> {
  let handle: fs.FileHandle | null = null
  try {
    handle = await fs.open(filePath, "wx")
    await handle.writeFile(content)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false
    throw err
  } finally {
    await handle?.close()
  }
}

async function readFileIfPresent(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
    throw err
  }
}

async function unlinkIfPresent(filePath: string): Promise<boolean> {
  try {
    await fs.unlink(filePath)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false
    throw err
  }
}

function sameOwner(a: PipelineLock, b: PipelineLock): boolean {
  return (
    a.run_id === b.run_id &&
    a.pid === b.pid &&
    a.fingerprint === b.fingerprint
  )
}

function alreadyRunning(reason: string): PipelineLockAcquireResult {
  return {
    ok: false,
    decision: "PIPELINE_ALREADY_RUNNING",
    reason,
  }
}

function invalidLock(reason: string): PipelineLockAcquireResult {
  return {
    ok: false,
    decision: "PIPELINE_INVALID_LOCK",
    reason,
  }
}

function processPidStatus(pid: number): PidStatus {
  try {
    process.kill(pid, 0)
    return "alive"
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === "ESRCH") return "dead"
    if (code === "EPERM") return "alive"
    return "unknown"
  }
}
