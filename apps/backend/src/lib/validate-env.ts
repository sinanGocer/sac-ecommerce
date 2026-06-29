/**
 * Production env fail-fast doğrulaması (SAF, IO yok).
 *
 * Üretimde (NODE_ENV=production) eksik kritik env değişkenleri süreç başlamadan
 * açık bir hata ile durdurur. Geliştirme/test'te yalnız uyarı verir (yerel akışı
 * bozmaz). Secret HARDCODE etmez; yalnız varlık/zayıflık kontrolü yapar.
 *
 * medusa-config.ts loadEnv'den sonra çağırır.
 */

/** Her ortamda gereken kritik altyapı değişkenleri. */
export const REQUIRED_ENV_VARS = [
  "DATABASE_URL",
  "JWT_SECRET",
  "COOKIE_SECRET",
  "STORE_CORS",
  "ADMIN_CORS",
  "AUTH_CORS",
] as const

/** Üretimde kabul edilmeyen placeholder secret değerleri. */
export const WEAK_SECRET_VALUES = ["supersecret", "secret", "change-me", "changeme", ""]

/** İyzico sağlayıcısı açıksa ek olarak gereken değişkenler. */
export const IYZICO_REQUIRED_WHEN_ENABLED = [
  "IYZICO_API_KEY",
  "IYZICO_SECRET_KEY",
  "IYZICO_BASE_URL",
] as const

export interface EnvValidationResult {
  ok: boolean
  isProduction: boolean
  missing: string[]
  weakSecrets: string[]
  problems: string[]
}

export function evaluateEnv(
  env: Record<string, string | undefined> = process.env
): EnvValidationResult {
  const isProduction = env.NODE_ENV === "production"

  const missing = REQUIRED_ENV_VARS.filter(
    (key) => !env[key] || String(env[key]).trim().length === 0
  ) as string[]

  if (env.IYZICO_PROVIDER_ENABLED === "true") {
    for (const key of IYZICO_REQUIRED_WHEN_ENABLED) {
      if (!env[key] || String(env[key]).trim().length === 0) missing.push(key)
    }
  }

  // Zayıf secret yalnız üretimde sorun sayılır.
  const weakSecrets: string[] = []
  if (isProduction) {
    for (const key of ["JWT_SECRET", "COOKIE_SECRET"]) {
      const val = (env[key] ?? "").trim().toLowerCase()
      if (val && WEAK_SECRET_VALUES.includes(val)) weakSecrets.push(key)
    }
  }

  const problems = [
    ...missing.map((k) => `missing required env: ${k}`),
    ...weakSecrets.map((k) => `weak/placeholder secret in production: ${k}`),
  ]

  return {
    ok: problems.length === 0,
    isProduction,
    missing: [...new Set(missing)],
    weakSecrets,
    problems,
  }
}

/**
 * Fail-fast: üretimde sorun varsa fırlatır; aksi halde uyarı verir.
 * Test/geliştirmede asla fırlatmaz (yerel akışı korur).
 */
export function validateRequiredEnv(
  env: Record<string, string | undefined> = process.env,
  logger: { warn: (m: string) => void } = console
): EnvValidationResult {
  const result = evaluateEnv(env)
  if (result.problems.length === 0) return result

  const message = `[env] Fail-fast doğrulama: ${result.problems.join("; ")}`
  if (result.isProduction) {
    throw new Error(message)
  }
  logger.warn(`${message} (NODE_ENV!=production: süreç devam ediyor)`)
  return result
}
