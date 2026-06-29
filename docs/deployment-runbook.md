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

## 8. Lot Costing — FIFO concurrency & entegrasyon testi

### 8.1 İzole test DB kurulumu
```bash
createdb medusa_sac_ecommerce_test          # adı MUTLAKA "_test" içermeli
cp apps/backend/.env.test.example apps/backend/.env.test   # .env.test COMMIT EDİLMEZ
```
Fail-closed guard'lar (`src/inventory-costing/__integration__/test-db.ts`): DB adında
`_test` yoksa / `NODE_ENV != test` ise / bilinen dev-prod DB adı algılanırsa testler
**başlamaz**. Secret'lar loglanmaz (URL maskelenir). Gerçek dev/prod DB'ye yazım imkânsız.

### 8.2 Entegrasyon testlerini çalıştırma
```bash
cd apps/backend
npm run inventory:costing:test          # saf birim testleri (DB'siz)
npm run inventory:costing:integration   # GERÇEK PostgreSQL (izole _test DB)
npm run rbac:test                       # yetki/redaksiyon
```
`integration` çıktısı: kullanılan test DB adı, uygulanan migration'lar, geçen/başarısız
sayısı ve concurrency senaryo sonucu (oversell=false) gösterir.

### 8.3 FIFO lock yöntemi
- Tüketim/reversal `LotCostingService.consumeFifoForItem` / `reverseFifoForOrder` ile
  **MikroORM transaction** içinde yapılır (`@InjectManager`).
- Tüketilecek lotlar `received_at ASC` sırasıyla **PESSIMISTIC_WRITE** (`SELECT … FOR
  UPDATE`) ile kilitlenir → eşzamanlı siparişler **serialize** olur.
- Kalan miktar transaction içindeki kilitli satırdan okunur; stok yetersizse hiçbir
  yazım yapılmadan **rollback** (oversell fail-closed).
- DB seviyesi son savunma: `cost_allocation.idempotency_key` UNIQUE index (duplicate
  allocation) + `inventory_cost_lot` CHECK `remaining>=0` ve `remaining<=received`.
- **Raw SQL yok, process-mutex yok, kilitsiz check-then-update yok.**

### 8.4 Deadlock / retry politikası
- Lotlar her zaman aynı sırada (`received_at ASC, id ASC`) kilitlenir → aynı varyantta
  deadlock beklenmez.
- Yine de `40001` (serialization_failure) / `40P01` (deadlock_detected) hatalarında
  **sınırlı (3) + loglanan** retry yapılır (kısa jitter backoff). Sessiz sonsuz döngü yok.

### 8.5 Feature flag açma sırası (production)
1. `LOT_COSTING_WRITE_ENABLED=true` → owner'dan stok girişi; **tüm mevcut stoğu lotlara
   bağla** (her satılan varyantın değerlenmiş lotu olmalı).
2. Doğrula: `UNVALUED_OPENING_STOCK` raporunda **0** kalmalı. **>0 ise FIFO'yu AÇMA** —
   subscriber aktivasyon guard'ı o varyantta FIFO'yu başlatmaz (güvenli no-op + operatör
   uyarısı, satış siparişi bozulmaz).
3. `LOT_COSTING_FIFO_ENABLED=true` → sipariş→allocation + iptal→reversal subscriber'ları.
4. `LOT_COSTING_JOBS_ENABLED=true` → forecast/reorder/accuracy (öneri-only).

> Migration: `reversed_quantity` kolonu + lot CHECK constraint'leri
> (`Migration20260629160000`) production deploy'da normal migration adımıyla uygulanır
> (`§3`). Bu fazda yalnız **izole test DB**'ye uygulandı; dev/prod'a dokunulmadı.

### 8.6 Sorun halinde rollback
- FIFO'da anormallik → `LOT_COSTING_FIFO_ENABLED=false` (subscriber anında no-op olur;
  yarım allocation kalmaz, her tüketim zaten atomiktir).
- Stok girişinde sorun → `LOT_COSTING_WRITE_ENABLED=false`.
- Allocation/lot kayıtları **silinmez**; iptal/iade reversal ile geri alınır (immutable
  audit korunur). Gerekirse `§4` genel rollback prosedürü.

## Kapsam dışı (kalan gerçek blocker'lar)
- **Ödeme (iyzico):** gerçek merchant + network transport (skeleton kapalı).
- **Gerçek e-posta:** notification provider + recipient resolution (şu an simüle).
- **Hata izleme (Sentry vb.):** entegrasyon noktası hazır, bağlanmadı.
