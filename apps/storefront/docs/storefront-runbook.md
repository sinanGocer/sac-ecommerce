# Storefront Runbook (production hazırlığı)

Ödeme (iyzico) ve gerçek e-posta hariç storefront MVP'nin operasyonel notları.

## Ortam değişkenleri
- `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` — ZORUNLU (build-time `check-env-variables.js` fail-fast).
- `NEXT_PUBLIC_MEDUSA_BACKEND_URL` — ZORUNLU (fail-fast).
- `NEXT_PUBLIC_BASE_URL` — production'da ZORUNLU + HTTPS (canonical/OG/sitemap). Dev'de boşsa localhost'a düşer.
- `NEXT_PUBLIC_DEFAULT_REGION` — varsayılan ülke kodu (`tr`).
- `REVALIDATE_SECRET` — `/api/revalidate` guard'ı. Boşsa uç 503 döner (kapalı kabul edilir).
Şablon: `.env.example`.

## SEO
- `metadataBase` `getBaseURL()` üzerinden env'e bağlı (`src/app/layout.tsx`).
- Ürün sayfası: canonical + Open Graph + Product JSON-LD + TRY fiyat (doğrulandı).
- `robots.txt` → `src/app/robots.ts` (checkout/account/api disallow, sitemap işaret).
- `sitemap.xml` → `src/app/sitemap.ts` (statik rotalar + yayınlanmış ürünler; backend
  erişilemezse fail-safe statik rotalar; saatlik ISR).

## Stale ürün cache & kontrollü revalidation
Ürün fetch'leri ziyaretçi-bazlı cache tag (`<tag>-<cacheId>`) kullanır; bu yüzden
global tag-purge mümkün değildir. Backend katalog değişiminden sonra (cleanup, yeni
ürün, fiyat) stale sayfaları temizlemek için **path-bazlı** on-demand revalidation:

```bash
curl -X POST "$NEXT_PUBLIC_BASE_URL/api/revalidate?secret=$REVALIDATE_SECRET"
# -> { "revalidated": true, "scope": "layout:/" }
```

Bu uç `revalidatePath("/", "layout")` çağırır (tüm route cache'i tazeler). Webhook
olarak Medusa `product.updated` / cleanup sonrası tetiklenebilir.

## Global HTTP 500 (runtime cache) kurtarma runbook'u
Daha önce wedged `next dev --turbopack` process'i + stale `.next` cache tüm route'larda
500'e yol açmıştı. Tekrarında operasyonel adımlar (kod değişikliği gerektirmez):

1. `lsof -ti:8000` ile process'i bul, durdur (gerekirse `kill -9`).
2. `rm -rf .next` (turbopack/route cache'i temizle).
3. Yeniden başlat: `npm run dev` (veya prod'da `npm run build && npm run start`).
4. `npm run smoke` ile doğrula.

Production'da kalıcı çözüm: stale içerik `sitemap`/sayfa ISR `revalidate` TTL'i ve
`/api/revalidate` ile sınırlandırılır; runtime 500 için süreç sağlık kontrolü +
otomatik restart (PM2/container healthcheck) önerilir.

## Smoke / readiness
```bash
npm run smoke   # home/store 200, ilk/son ürün 200, demo+KVKK 404, Store API 39, pagination
```
Salt-okunur; sipariş/ödeme oluşturmaz.

## Kapsam dışı (kalan gerçek blocker'lar)
- Ödeme (iyzico) — backend skeleton hazır, network kapalı.
- Gerçek e-posta gönderimi — backend notification simüle (NullProvider).
