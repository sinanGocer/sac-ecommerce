import { revalidatePath } from "next/cache"
import { NextRequest, NextResponse } from "next/server"

/**
 * Kontrollü on-demand cache invalidation.
 *
 * Storefront ürün fetch'leri ziyaretçi-bazlı cache tag (`<tag>-<cacheId>`)
 * kullandığından global `revalidateTag` mümkün değildir; bu yüzden PATH-bazlı
 * `revalidatePath("/", "layout")` ile tüm route cache'i güvenli biçimde
 * tazelenir. Backend katalog değişiminden sonra (ör. salon-seed cleanup veya
 * yeni ürün) operatör/webhook bu ucu çağırarak stale ürün sayfalarını temizler.
 *
 * Guard: `REVALIDATE_SECRET` env zorunlu; eşleşmeyen/eksik secret → yazım yok.
 */
export const dynamic = "force-dynamic"

function authorize(req: NextRequest): { ok: boolean; status: number; error?: string } {
  const secret = process.env.REVALIDATE_SECRET
  if (!secret) {
    return { ok: false, status: 503, error: "REVALIDATE_SECRET is not configured" }
  }
  const provided =
    req.nextUrl.searchParams.get("secret") ??
    req.headers.get("x-revalidate-secret") ??
    ""
  if (provided !== secret) {
    return { ok: false, status: 401, error: "unauthorized" }
  }
  return { ok: true, status: 200 }
}

export async function POST(req: NextRequest) {
  const auth = authorize(req)
  if (!auth.ok) {
    return NextResponse.json({ revalidated: false, error: auth.error }, { status: auth.status })
  }

  // Path-based purge of the full route tree (catalog + listing + detail).
  revalidatePath("/", "layout")

  return NextResponse.json({
    revalidated: true,
    scope: "layout:/",
    now: new Date().toISOString(),
  })
}

export async function GET() {
  // Hafif kullanım/erişilebilirlik probu (secret gerektirmez, mutation yok).
  return NextResponse.json({
    ok: true,
    usage: "POST /api/revalidate?secret=<REVALIDATE_SECRET> to purge catalog cache",
    configured: Boolean(process.env.REVALIDATE_SECRET),
  })
}
