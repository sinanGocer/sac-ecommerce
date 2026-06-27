import { loadEnv, defineConfig, Modules } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

type MedusaModuleConfig = {
  resolve: string
  options?: Record<string, unknown>
}

const modules: MedusaModuleConfig[] = [
  {
    resolve: "./src/modules/customer-messaging-automation",
  },
  {
    resolve: "./src/modules/search-projection",
  },
]

if (process.env.IYZICO_PROVIDER_ENABLED === "true") {
  modules.push({
    resolve: Modules.PAYMENT,
    options: {
      providers: [
        {
          resolve: "./src/modules/iyzico-payment",
          id: "iyzico",
          options: {
            mode: process.env.IYZICO_MODE,
            apiKey: process.env.IYZICO_API_KEY,
            secretKey: process.env.IYZICO_SECRET_KEY,
            baseUrl: process.env.IYZICO_BASE_URL,
            callbackUrl: process.env.IYZICO_CALLBACK_URL,
            returnUrl: process.env.IYZICO_RETURN_URL,
            webhookSecret: process.env.IYZICO_WEBHOOK_SECRET,
            networkEnabled: process.env.IYZICO_NETWORK_ENABLED,
          },
        },
      ],
    },
  })
}

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    }
  },
  modules,
})
