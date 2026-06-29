# Production Deployment Runbook (ödeme/e-posta hariç)

Gerçek deploy bu repoda YAPILMADI. Bu doküman, hazırlanan artefaktlarla
production'a çıkış prosedürünü tanımlar.

## 1. Mimari

| Servis | Teknoloji | Notlar |
|---|---|---|
| Backend API | Medusa v2.16 (Node 22) | `apps/backend`, port 9000, `/health` readiness |
| Storefront | Next.js 15 standalone (Node 22) | `apps/storefront`, port 8000 |
| Database | PostgreSQL 16 (managed önerilir) | SSL (`sslmode=require`), kalıcı disk |
| Cache/Bus | Redis 7 (managed önerilir) | event bus + workflow engine + cache |
| Görsel | S3/CDN (opsiyonel) | `next/image` remotePatterns |

Servis ayrımı:
- **web (backend):** HTTP API + admin. Yatay ölçeklenebilir (stateless; Redis paylaşımlı).
- **worker (opsiyonel):** uzun/iş kuyruğu için ayrı Medusa instance (`MEDUSA_WORKER_MODE=worker`).
  MVP'de tek instance yeterli; trafik artınca web/worker ayrımı önerilir.
- **storefront:** statik+SSR Next server; backend'den bağımsız ölçeklenir.

Persistent storage: yalnız PostgreSQL (+ görseller için S3). Storefront ve backend
container'ları stateless'tir (yerel diske kalıcı veri yazmaz).

## 2. Ortam değişkenleri
- Backend: `apps/backend/.env.production.example` → `.env.production`.
- Storefront: `apps/storefront/.env.production.example` → `.env.production`.
- Fail-fast: backend `src/lib/validate-env.ts` (production'da eksik/zayıf secret →
  süreç durur); storefront `check-env-variables.js` (key + backend URL + HTTPS base URL).
- Güçlü secret üretimi: `openssl rand -base64 32` (JWT/COOKIE), `openssl rand -hex 24`
  (REVALIDATE_SECRET). **Secret'lar repoya yazılmaz**; deploy ortamının secret store'unda.
- CORS: `STORE_CORS`/`ADMIN_CORS`/`AUTH_CORS` gerçek domain'ler.
- DB SSL: `DATABASE_URL=...?sslmode=require`.

## 3. Migration & başlangıç sırası
1. **DB hazır** (managed Postgres up, erişim açık).
2. **Migration:** `npx medusa db:migrate` (idempotent; yalnız bekleyen migration'ları uygular).
   - İlk kurulum: `npx medusa db:setup` (create + migrate + sync-links).
   - Link şeması: gerekirse `npx medusa db:sync-links`.
3. **Backend start:** `npx medusa start` (Docker image CMD: `db:migrate && start`).
4. **Readiness:** `GET /health` → 200 beklenir (healthcheck 40s start-period).
5. **Storefront start:** `node apps/storefront/server.js` (standalone). NEXT_PUBLIC_*
   build-time'da gömülü olmalı (image build ARG'ları).
6. **Smoke:** `apps/storefront` → `npm run smoke` (home/store 200, ürün 200, demo/KVKK 404,
   Store API ürün sayısı, pagination). Salt-okunur.

Çok-instance'ta migration'ı başlangıç CMD'sinden ayırıp tek seferlik **release job**
olarak çalıştırın (race önler).

## 4. Rollback prosedürü
- **Uygulama:** önceki image tag'ine geri dön (backend + storefront). Storefront
  NEXT_PUBLIC_* değiştiyse yeniden build gerekir.
- **DB migration:** `npx medusa db:rollback` (son batch'i geri alır). DİKKAT: geri
  alınamaz veri kaybı riski; önce **backup**. Migration'lar geriye uyumlu yazıldıysa
  tercih: uygulamayı geri al, şemayı bırak (expand/contract deseni).
- **Doğrulama:** rollback sonrası `/health` + `npm run smoke`.

## 5. Operasyon
- **Loglama:** her iki servis stdout/stderr'e yazar (container log driver / log
  aggregator'a yönlendirin). Backend Medusa logger; storefront Next + `logging.fetches`.
- **Hata yakalama entegrasyon noktası:** Sentry vb. eklemek için tek nokta —
  backend: `instrumentation.ts` (Medusa) / global error middleware; storefront:
  `app/global-error.tsx` + `instrumentation.ts`. (Bu MVP'de bağlanmadı; açık TODO.)
- **Backup/restore:**
  - Backup: `pg_dump "$DATABASE_URL" -Fc -f backup-$(date +%F).dump` (günlük, S3'e).
  - Restore: `pg_restore --clean --if-exists -d "$DATABASE_URL" backup.dump`.
  - Managed Postgres'te PITR + otomatik snapshot önerilir.
- **Cache revalidation:** katalog değişiminden sonra storefront stale sayfaları:
  `curl -X POST "$NEXT_PUBLIC_BASE_URL/api/revalidate?secret=$REVALIDATE_SECRET"`.
  Detay: `apps/storefront/docs/storefront-runbook.md`.
- **Secret rotation:** secret store'da değeri güncelle → servisleri yeniden başlat.
  `JWT_SECRET`/`COOKIE_SECRET` rotasyonu aktif oturumları/cookie'leri geçersiz kılar
  (kullanıcılar yeniden giriş yapar) — düşük trafik penceresinde yapın. Publishable key
  rotasyonu: admin'de yeni key üret → storefront env güncelle → yeniden build/deploy.
- **Runtime 500 kurtarma (storefront):** wedged dev/stale cache → process restart +
  `.next` temizliği (detay storefront runbook). Production'da healthcheck + auto-restart.

## 6. CI doğrulaması
CI workflow şablonu: `docs/ci-workflow.example.yml`. Etkinleştirmek için
`.github/workflows/ci.yml` olarak kopyalayın (bu repoyu push eden token'da
`workflow` scope'u gerekir; bu hazırlık paketinde scope olmadığından şablon
`docs/` altında tutuldu). İçerik: temiz `npm ci` → backend isolated testler →
backend build → storefront production env validation + build → `git diff --check`
→ iki Docker image build.

```bash
mkdir -p .github/workflows && cp docs/ci-workflow.example.yml .github/workflows/ci.yml
git add .github/workflows/ci.yml && git commit -m "ci: enable workflow" && git push
```

## 7. Gerçek deploy öncesi kullanıcıdan gereken bilgiler
- Managed **PostgreSQL** bağlantısı (SSL) ve **Redis** URL'i.
- Gerçek **domain'ler** (storefront + api + admin) ve TLS sertifikaları/DNS.
- Üretilmiş güçlü **secret'lar** (JWT/COOKIE/AUTH_MFA/REVALIDATE) — secret store'da.
- Backend admin'den üretilmiş **publishable key** (production region/sales-channel ile).
- Görsel barındırma (S3/CDN) host bilgisi (opsiyonel).
- Hosting platformu seçimi (container platform / VM / PaaS).

## Kapsam dışı (kalan gerçek blocker'lar)
- **Ödeme (iyzico):** gerçek merchant + network transport (skeleton kapalı).
- **Gerçek e-posta:** notification provider + recipient resolution (şu an simüle).
- **Hata izleme (Sentry vb.):** entegrasyon noktası hazır, bağlanmadı.
