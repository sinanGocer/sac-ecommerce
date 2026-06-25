import assert from "assert"
import { promises as fs } from "fs"
import os from "os"
import path from "path"

import {
  PipelineLock,
  PipelineLockPaths,
  PipelineRecoveryLock,
  acquirePipelineLock,
  lockIdentity,
  parseLock,
  releasePipelineLock,
  releaseRecoveryMutex,
  serializeLock,
  serializeRecoveryLock,
} from "../catalog-batch-lock"

const NOW = Date.parse("2026-06-25T20:00:00.000Z")
const LOCK_TTL = 60 * 60 * 1000
const RECOVERY_TTL = 5 * 60 * 1000
const STALE_AT = "2026-06-25T18:00:00.000Z"
const FRESH_AT = "2026-06-25T19:59:30.000Z"

export interface LockFilesystemTestResult {
  assertions: number
  concurrency_rounds: number
}

export async function runLockFilesystemTests(): Promise<LockFilesystemTestResult> {
  let assertions = 0
  const check = (condition: unknown, message: string): void => {
    assert.ok(condition, message)
    assertions++
  }

  for (let round = 0; round < 20; round++) {
    await withTempPaths(async (paths) => {
      await writeMain(paths, makeLock("stale", 9000, STALE_AT))
      const results = await Promise.allSettled([
        acquire(paths, makeLock(`a-${round}`, 1001)),
        acquire(paths, makeLock(`b-${round}`, 1002)),
      ])
      const fulfilled = results
        .filter(
          (
            result
          ): result is PromiseFulfilledResult<
            Awaited<ReturnType<typeof acquire>>
          > => result.status === "fulfilled"
        )
        .map((result) => result.value)
      const successes = fulfilled.filter((result) => result.ok)
      check(successes.length === 1, `round ${round}: exactly one acquisition`)
      check(
        fulfilled.length === 2 &&
          fulfilled.filter((result) => !result.ok).length === 1,
        `round ${round}: loser fails closed`
      )
      if (successes[0]?.ok) {
        await releasePipelineLock(paths.lockPath, successes[0].lock)
      }
    })
  }

  await withTempPaths(async (paths) => {
    const stale = makeLock("stale", 9000, STALE_AT)
    const a = makeLock("a", 1001)
    const b = makeLock("b", 1002)
    await writeMain(paths, stale)
    const bRead = deferred<void>()
    const continueB = deferred<void>()
    const bAcquire = acquire(paths, b, {
      afterInitialLockRead: async () => {
        bRead.resolve()
        await continueB.promise
      },
    })
    await bRead.promise
    const aResult = await acquire(paths, a)
    check(aResult.ok, "A acquires recovered main lock")
    continueB.resolve()
    const bResult = await bAcquire
    check(!bResult.ok, "B fails after stale evaluation becomes obsolete")
    check(
      lockIdentity(await readMain(paths)) === lockIdentity(a),
      "B does not delete A's new lock"
    )
    await releasePipelineLock(paths.lockPath, a)
  })

  await withTempPaths(async (paths) => {
    await writeMain(paths, makeLock("stale", 9000, STALE_AT))
    const mutexHeld = deferred<void>()
    const releaseMutex = deferred<void>()
    let mutexOwners = 0
    const a = acquire(paths, makeLock("a", 1001), {
      afterRecoveryMutexAcquired: async () => {
        mutexOwners++
        mutexHeld.resolve()
        await releaseMutex.promise
      },
    })
    await mutexHeld.promise
    const b = await acquire(paths, makeLock("b", 1002))
    check(!b.ok, "second recovery contender fails closed")
    check(mutexOwners === 1, "recovery mutex has one owner")
    releaseMutex.resolve()
    const aResult = await a
    check(aResult.ok, "recovery mutex owner completes")
    if (aResult.ok) await releasePipelineLock(paths.lockPath, aResult.lock)
  })

  await withTempPaths(async (paths) => {
    const replacement = makeLock("live-replacement", 1003)
    await writeMain(paths, makeLock("stale", 9000, STALE_AT))
    const result = await acquire(paths, makeLock("recoverer", 1001), {
      afterInitialLockRead: async () => {
        await fs.unlink(paths.lockPath)
        await writeMain(paths, replacement)
      },
    })
    check(!result.ok, "identity change blocks takeover")
    check(
      lockIdentity(await readMain(paths)) === lockIdentity(replacement),
      "replacement lock is preserved"
    )
  })

  await withTempPaths(async (paths) => {
    await writeMain(paths, makeLock("stale", 9000, STALE_AT))
    const owner = makeLock("new", 1001)
    const result = await acquire(paths, owner)
    check(result.ok && result.recovered_stale_lock, "stale recovery succeeds")
    check(
      lockIdentity(await readMain(paths)) === lockIdentity(owner),
      "new owner holds main lock"
    )
    check(!(await exists(paths.recoveryPath)), "recovery mutex is cleaned")
    await releasePipelineLock(paths.lockPath, owner)
  })

  await withTempPaths(async (paths) => {
    const liveOld = makeLock("live-old", 1003, STALE_AT)
    await writeMain(paths, liveOld)
    const result = await acquire(paths, makeLock("new", 1001))
    check(!result.ok, "live old lock is not stale")
    check(
      lockIdentity(await readMain(paths)) === lockIdentity(liveOld),
      "live old lock is preserved"
    )
  })

  await withTempPaths(async (paths) => {
    const deadFresh = makeLock("dead-fresh", 9000, FRESH_AT)
    await writeMain(paths, deadFresh)
    const result = await acquire(paths, makeLock("new", 1001))
    check(!result.ok, "dead but fresh lock is not stale")
    check(
      lockIdentity(await readMain(paths)) === lockIdentity(deadFresh),
      "dead fresh lock is preserved"
    )
  })

  await withTempPaths(async (paths) => {
    const unknown = makeLock("unknown", 8000, STALE_AT)
    await writeMain(paths, unknown)
    const result = await acquire(paths, makeLock("new", 1001))
    check(!result.ok, "unknown PID lock is not stale")
    check(
      lockIdentity(await readMain(paths)) === lockIdentity(unknown),
      "unknown PID lock is preserved"
    )
  })

  await withTempPaths(async (paths) => {
    await fs.writeFile(paths.lockPath, "{broken")
    const result = await acquire(paths, makeLock("new", 1001))
    check(
      result.ok === false && result.decision === "PIPELINE_INVALID_LOCK",
      "broken main lock is invalid"
    )
    check((await fs.readFile(paths.lockPath, "utf-8")) === "{broken", "broken main lock is not deleted")
  })

  await withTempPaths(async (paths) => {
    await writeMain(paths, makeLock("stale", 9000, STALE_AT))
    await fs.writeFile(paths.recoveryPath, "{broken")
    const result = await acquire(paths, makeLock("new", 1001))
    check(
      result.ok === false && result.decision === "PIPELINE_INVALID_LOCK",
      "broken recovery mutex is invalid"
    )
    check(
      (await fs.readFile(paths.recoveryPath, "utf-8")) === "{broken",
      "broken recovery mutex is not deleted"
    )
  })

  await withTempPaths(async (paths) => {
    const staleMain = makeLock("stale", 9000, STALE_AT)
    await writeMain(paths, staleMain)
    const staleRecovery: PipelineRecoveryLock = {
      ...makeLock("dead-recovery", 9001, STALE_AT),
      target_lock_identity: lockIdentity(staleMain),
    }
    await fs.writeFile(
      paths.recoveryPath,
      serializeRecoveryLock(staleRecovery)
    )
    const owner = makeLock("new", 1001)
    const result = await acquire(paths, owner)
    check(result.ok, "stale recovery mutex can be recovered")
    check(!(await exists(paths.recoveryPath)), "recovered mutex is cleaned")
    if (result.ok) await releasePipelineLock(paths.lockPath, result.lock)
  })

  await withTempPaths(async (paths) => {
    const own = makeLock("own", 1001)
    const other = makeLock("other", 1002)
    await writeMain(paths, other)
    check(
      !(await releasePipelineLock(paths.lockPath, own)),
      "other main lock is not released"
    )
    check(
      lockIdentity(await readMain(paths)) === lockIdentity(other),
      "other main lock remains"
    )
    check(
      await releasePipelineLock(paths.lockPath, other),
      "own main lock is released"
    )

    const ownRecovery: PipelineRecoveryLock = {
      ...own,
      target_lock_identity: "target",
    }
    const otherRecovery: PipelineRecoveryLock = {
      ...other,
      target_lock_identity: "target",
    }
    await fs.writeFile(
      paths.recoveryPath,
      serializeRecoveryLock(otherRecovery)
    )
    check(
      !(await releaseRecoveryMutex(paths.recoveryPath, ownRecovery)),
      "other recovery mutex is not released"
    )
    check(
      await releaseRecoveryMutex(paths.recoveryPath, otherRecovery),
      "own recovery mutex is released"
    )
  })

  await withTempPaths(async (paths) => {
    const replacement = makeLock("replacement", 1003)
    await writeMain(paths, makeLock("stale", 9000, STALE_AT))
    let threw = false
    try {
      await acquire(paths, makeLock("recoverer", 1001), {
        afterRecoveryMutexAcquired: async () => {
          await fs.unlink(paths.lockPath)
          await writeMain(paths, replacement)
          throw new Error("controlled")
        },
      })
    } catch (err) {
      threw = err instanceof Error && err.message === "controlled"
    }
    check(threw, "controlled recovery exception is surfaced")
    check(!(await exists(paths.recoveryPath)), "own recovery mutex is cleaned after exception")
    check(
      lockIdentity(await readMain(paths)) === lockIdentity(replacement),
      "replacement main lock survives recovery exception"
    )
  })

  return { assertions, concurrency_rounds: 20 }
}

function acquire(
  paths: PipelineLockPaths,
  lock: PipelineLock,
  hooks: Parameters<typeof acquirePipelineLock>[0]["hooks"] = {}
) {
  return acquirePipelineLock({
    paths,
    lock,
    lockStaleMs: LOCK_TTL,
    recoveryStaleMs: RECOVERY_TTL,
    nowMs: () => NOW,
    getPidStatus: (pid) => {
      if (pid >= 9000) return "dead"
      if (pid === 8000) return "unknown"
      return "alive"
    },
    hooks,
  })
}

function makeLock(
  runId: string,
  pid: number,
  startedAt = "2026-06-25T20:00:00.000Z"
): PipelineLock {
  return {
    run_id: runId,
    pid,
    started_at: startedAt,
    fingerprint: `fp-${runId}`,
  }
}

async function withTempPaths(
  fn: (paths: PipelineLockPaths) => Promise<void>
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "catalog-lock-test-"))
  const paths = {
    lockPath: path.join(dir, "catalog-batch.lock"),
    recoveryPath: path.join(dir, "catalog-batch.lock.recovery"),
  }
  try {
    await fn(paths)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

async function writeMain(
  paths: PipelineLockPaths,
  lock: PipelineLock
): Promise<void> {
  await fs.writeFile(paths.lockPath, serializeLock(lock))
}

async function readMain(paths: PipelineLockPaths): Promise<PipelineLock> {
  const parsed = parseLock(await fs.readFile(paths.lockPath, "utf-8"))
  assert.equal(parsed.kind, "valid")
  return parsed.kind === "valid" ? parsed.data : makeLock("invalid", 0)
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false
    throw err
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}
