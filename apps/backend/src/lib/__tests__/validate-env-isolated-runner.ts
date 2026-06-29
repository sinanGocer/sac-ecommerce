/* eslint-disable no-console */
import assert from "assert"

import {
  evaluateEnv,
  validateRequiredEnv,
} from "../validate-env"

let passed = 0
function ok(cond: unknown, label: string): void {
  assert.ok(cond, label)
  passed++
}

function baseEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://x",
    JWT_SECRET: "a-strong-secret-value",
    COOKIE_SECRET: "another-strong-secret",
    STORE_CORS: "http://localhost:8000",
    ADMIN_CORS: "http://localhost:9000",
    AUTH_CORS: "http://localhost:9000",
    ...overrides,
  }
}

function main(): void {
  // 1) Tüm zorunlular mevcut → ok
  const good = evaluateEnv(baseEnv())
  ok(good.ok && good.problems.length === 0, "1 all present ok")

  // 2) Eksik DATABASE_URL → problem
  const noDb = evaluateEnv(baseEnv({ DATABASE_URL: "" }))
  ok(!noDb.ok && noDb.missing.includes("DATABASE_URL"), "2 missing db reported")

  // 3) Üretimde zayıf secret → problem
  const weak = evaluateEnv(baseEnv({ JWT_SECRET: "supersecret", COOKIE_SECRET: "secret" }))
  ok(
    !weak.ok && weak.weakSecrets.includes("JWT_SECRET") && weak.weakSecrets.includes("COOKIE_SECRET"),
    "3 weak secrets reported in production"
  )

  // 4) Dev'de zayıf secret sorun DEĞİL
  const devWeak = evaluateEnv(baseEnv({ NODE_ENV: "development", JWT_SECRET: "supersecret" }))
  ok(devWeak.weakSecrets.length === 0, "4 weak secret ignored in dev")

  // 5) İyzico açık + eksik credential → missing
  const iyz = evaluateEnv(baseEnv({ IYZICO_PROVIDER_ENABLED: "true" }))
  ok(
    !iyz.ok && iyz.missing.includes("IYZICO_API_KEY") && iyz.missing.includes("IYZICO_SECRET_KEY"),
    "5 iyzico enabled requires credentials"
  )

  // 6) İyzico açık + credential dolu → ok
  const iyzOk = evaluateEnv(
    baseEnv({ IYZICO_PROVIDER_ENABLED: "true", IYZICO_API_KEY: "k", IYZICO_SECRET_KEY: "s", IYZICO_BASE_URL: "https://x" })
  )
  ok(iyzOk.ok, "6 iyzico enabled with credentials ok")

  // 7) İyzico kapalı → credential gerekmez
  const iyzOff = evaluateEnv(baseEnv({ IYZICO_PROVIDER_ENABLED: "false" }))
  ok(iyzOff.ok, "7 iyzico disabled needs no credentials")

  // 8) validateRequiredEnv: production + eksik → throw
  let threw = false
  try {
    validateRequiredEnv(baseEnv({ JWT_SECRET: "" }), { warn: () => {} })
  } catch {
    threw = true
  }
  ok(threw, "8 production missing throws")

  // 9) validateRequiredEnv: dev + eksik → throw etmez, uyarır
  let warned = false
  const res = validateRequiredEnv(
    baseEnv({ NODE_ENV: "development", JWT_SECRET: "" }),
    { warn: () => { warned = true } }
  )
  ok(warned && !res.ok, "9 dev missing warns not throws")

  // 10) validateRequiredEnv: temiz → throw/warn yok
  let warned2 = false
  const clean = validateRequiredEnv(baseEnv(), { warn: () => { warned2 = true } })
  ok(clean.ok && !warned2, "10 clean env no warn/throw")

  console.log(`[validate-env:test] ${passed} assertions passed`)
}

try {
  main()
} catch (e) {
  console.error("VALIDATE-ENV TEST FAILED:", e instanceof Error ? e.message : e)
  process.exit(1)
}
