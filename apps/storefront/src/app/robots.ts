import { MetadataRoute } from "next"

import { getBaseURL } from "@lib/util/env"

/**
 * Native robots.txt (App Router). Base URL env'den (getBaseURL) gelir.
 * Checkout / account / api yollarını dışlar; sitemap'i işaret eder.
 */
export default function robots(): MetadataRoute.Robots {
  const base = getBaseURL()
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/checkout", "/account", "/api/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  }
}
