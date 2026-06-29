import { MetadataRoute } from "next"

import { getBaseURL } from "@lib/util/env"

/**
 * Native sitemap.xml (App Router). Statik rotalar + Store API'den yayınlanmış
 * ürünler. Backend erişilemezse fail-safe: yalnız statik rotalar döner (build
 * kırılmaz). Saatlik ISR ile tazelenir.
 */
export const revalidate = 3600

const BACKEND_URL =
  process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "http://localhost:9000"
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ""
const COUNTRY = (process.env.NEXT_PUBLIC_DEFAULT_REGION || "tr").toLowerCase()

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getBaseURL()
  const now = new Date()

  const staticRoutes: MetadataRoute.Sitemap = ["", "/store"].map((path) => ({
    url: `${base}/${COUNTRY}${path}`,
    lastModified: now,
    changeFrequency: "daily",
    priority: path === "" ? 1 : 0.8,
  }))

  let productRoutes: MetadataRoute.Sitemap = []
  try {
    const res = await fetch(
      `${BACKEND_URL}/store/products?limit=200&fields=handle,updated_at`,
      {
        headers: { "x-publishable-api-key": PUBLISHABLE_KEY },
        next: { revalidate },
      }
    )
    if (res.ok) {
      const json = (await res.json()) as {
        products?: Array<{ handle?: string | null; updated_at?: string | null }>
      }
      productRoutes = (json.products ?? [])
        .filter((p): p is { handle: string; updated_at?: string | null } =>
          typeof p.handle === "string" && p.handle.length > 0
        )
        .map((p) => ({
          url: `${base}/${COUNTRY}/products/${p.handle}`,
          lastModified: p.updated_at ? new Date(p.updated_at) : now,
          changeFrequency: "weekly",
          priority: 0.6,
        }))
    }
  } catch {
    // Backend erişilemez → yalnız statik rotalar (fail-safe).
  }

  return [...staticRoutes, ...productRoutes]
}
