/**
 * withTemporaryEnv — bir aşama boyunca geçici env uygular, finally'de eski
 * değerleri TAM olarak geri yükler. Başlangıçta tanımsız olan anahtarlar
 * restore sırasında silinir. Bir aşamanın env'i diğerine sızmaz.
 *
 * vars değeri:
 *   string → o anahtarı bu kapsamda set eder
 *   null   → o anahtarı bu kapsamda SİLER (örn. SYNC_COMMIT'i kapatmak)
 */
export async function withTemporaryEnv<T>(
  env: NodeJS.ProcessEnv,
  vars: Record<string, string | null>,
  fn: () => Promise<T>
): Promise<T> {
  const previous: Record<string, string | undefined> = {}
  for (const key of Object.keys(vars)) {
    previous[key] = env[key]
  }
  for (const [key, value] of Object.entries(vars)) {
    if (value === null) delete env[key]
    else env[key] = value
  }
  try {
    return await fn()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete env[key]
      else env[key] = value
    }
  }
}
