import { fail } from "./errors"
import type { IyzicoConfig, IyzicoMode, IyzicoProviderOptions } from "./types"

const SANDBOX_URL_HINTS = ["sandbox", "sandbox-api"]
const PRODUCTION_URL_HINTS = ["api.iyzipay.com", "iyzipay.com"]

export function parseIyzicoConfig(options: IyzicoProviderOptions = {}, env = process.env): IyzicoConfig {
  const mode = value(options.mode, env.IYZICO_MODE)
  if (mode !== "sandbox" && mode !== "production") {
    fail("invalid_mode", "IYZICO_MODE must be sandbox or production.")
  }

  if (mode === "production" && isLocalNodeEnv(env)) {
    fail("production_local_blocked", "Iyzico production mode is blocked in local/development environments.")
  }

  const apiKey = required("IYZICO_API_KEY", value(options.apiKey, env.IYZICO_API_KEY))
  const secretKey = required("IYZICO_SECRET_KEY", value(options.secretKey, env.IYZICO_SECRET_KEY))
  const baseUrl = required("IYZICO_BASE_URL", value(options.baseUrl, env.IYZICO_BASE_URL))
  const callbackUrl = required("IYZICO_CALLBACK_URL", value(options.callbackUrl, env.IYZICO_CALLBACK_URL))
  const returnUrl = required("IYZICO_RETURN_URL", value(options.returnUrl, env.IYZICO_RETURN_URL))
  const webhookSecret = value(options.webhookSecret, env.IYZICO_WEBHOOK_SECRET) || undefined
  const networkEnabled = parseBoolean(value(String(options.networkEnabled ?? ""), env.IYZICO_NETWORK_ENABLED), false)
  const maxSandboxAmount = options.maxSandboxAmount ?? 10000

  validateUrlPair(mode, baseUrl, callbackUrl)
  validateUrlPair(mode, baseUrl, returnUrl)

  if (mode === "sandbox" && looksLikeLiveCredential(apiKey, secretKey)) {
    fail("live_credential_in_sandbox", "Iyzico sandbox mode rejected a credential that looks live.")
  }

  return {
    mode,
    apiKey,
    secretKey,
    baseUrl,
    callbackUrl,
    returnUrl,
    webhookSecret,
    networkEnabled,
    maxSandboxAmount,
  }
}

export function redactedIyzicoConfig(config: IyzicoConfig) {
  return {
    mode: config.mode,
    apiKey: redact(config.apiKey),
    secretKey: redact(config.secretKey),
    baseUrl: config.baseUrl,
    callbackUrl: config.callbackUrl,
    returnUrl: config.returnUrl,
    webhookSecret: config.webhookSecret ? redact(config.webhookSecret) : null,
    networkEnabled: config.networkEnabled,
    maxSandboxAmount: config.maxSandboxAmount,
  }
}

export function fakeSandboxConfig(): IyzicoConfig {
  return parseIyzicoConfig(
    {
      mode: "sandbox",
      apiKey: "sandbox-api-key",
      secretKey: "sandbox-secret-key",
      baseUrl: "https://sandbox-api.iyzipay.com",
      callbackUrl: "http://localhost:9000/hooks/iyzico/callback",
      returnUrl: "http://localhost:8000/tr/checkout?step=payment-return",
      webhookSecret: "sandbox-webhook-secret",
      networkEnabled: false,
    },
    { NODE_ENV: "test" } as NodeJS.ProcessEnv
  )
}

function value(option: string | undefined, envValue: string | undefined): string {
  return String(option || envValue || "").trim()
}

function required(name: string, v: string): string {
  if (!v) fail("missing_config", `${name} is required for Iyzico provider registration.`)
  return v
}

function parseBoolean(v: string, fallback: boolean): boolean {
  if (!v) return fallback
  return v === "true"
}

function isLocalNodeEnv(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV !== "production" && env.IYZICO_ALLOW_PRODUCTION_LOCAL !== "true"
}

function validateUrlPair(mode: IyzicoMode, baseUrl: string, url: string): void {
  const lowerBase = baseUrl.toLowerCase()
  const lowerUrl = url.toLowerCase()
  if (mode === "sandbox" && !SANDBOX_URL_HINTS.some((hint) => lowerBase.includes(hint))) {
    fail("sandbox_live_url_mismatch", "Sandbox mode requires an Iyzico sandbox base URL.")
  }
  if (mode === "production" && SANDBOX_URL_HINTS.some((hint) => lowerBase.includes(hint))) {
    fail("production_sandbox_url_mismatch", "Production mode rejects sandbox base URLs.")
  }
  if (mode === "production" && lowerUrl.includes("localhost")) {
    fail("production_local_callback_blocked", "Production mode rejects localhost callback/return URLs.")
  }
  if (mode === "production" && !PRODUCTION_URL_HINTS.some((hint) => lowerBase.includes(hint))) {
    fail("production_unknown_url", "Production mode requires an Iyzico production base URL.")
  }
}

function looksLikeLiveCredential(apiKey: string, secretKey: string): boolean {
  return /(^|[_-])live([_-]|$)/i.test(apiKey) || /(^|[_-])live([_-]|$)/i.test(secretKey)
}

function redact(v: string): string {
  if (!v) return ""
  if (v.length <= 4) return "****"
  return `${v.slice(0, 2)}****${v.slice(-2)}`
}
