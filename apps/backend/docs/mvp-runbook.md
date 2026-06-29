# Backend MVP Runbook (ödeme hariç)

Bu doküman, ödeme entegrasyonu hariç backend MVP'nin operasyonel durumunu ve
kalan gerçek blocker'ları özetler. Kod değil, çalıştırma/operasyon notudur.

## Sipariş yaşam döngüsü
- Cart → shipping → order akışı Medusa core ile çalışır.
- Kontrollü test/temizlik araçları (hepsi dry-run-first, fingerprint onaylı):
  - `npm run checkout:test-order:dry` — uçtan uca tek test siparişi planı
  - `npm run test-order:cancel:dry` — test siparişi iptali (cancelOrderWorkflow)
  - `npm run partial-cart:cleanup:dry` — yarım kalan cart temizliği
  - `npm run cart:cleanup:dry` — cart line temizliği
- Duplicate order gate: `checkout-test` içinde aktif test e-postası/duplicate kontrolü.
- Cancel/refund/fulfillment: cancel akışı `test-order-cancel` ile test edilir; refund
  iyzico gerçek bağlantısına bağlıdır (aşağıdaki blocker).

## Stok ve satış güvenliği
- Search Projection politikası yalnız `published` ürünleri yüzeye çıkarır; draft /
  kanalsız ürün Store API'den sızmaz (doğrulandı: 39 görünür, 0 leak).
- Tüm görünür ürünlerin varyantı ve TRY fiyatı vardır (audit: 0 eksik).
- Stok dışı davranış Medusa inventory modülüne bağlıdır.

## Kargo
- Region: **Türkiye (TRY)**, ülke `tr`.
- Shipping option: **"Türkiye Standart Kargo"**, flat **59 TRY**, kural
  `enabled_in_store=true` + `is_return=false` → checkout'ta seçilebilir.
- Ücretsiz kargo eşiği: `tr-shipping-setup` aracı `TR_SHIPPING_FREE_THRESHOLD`
  destekler; şu an canlıda yalnız flat ücret tanımlı (eşik opsiyonel).

## Bildirim (notification)
- `customer-messaging-automation` modülü tüm kanallarda **NullMessageProvider**
  kullanır → **gerçek e-posta/SMS GÖNDERMEZ** (status `sent`, `simulated: true`).
  Bu, test sırasında gerçek e-posta riskini fail-safe biçimde ortadan kaldırır.
- Event altyapısı:
  - `order.created` abonesi → `order-created-message.ts`
  - `order.canceled` abonesi → `order-canceled-message.ts`
  - İkisi de şu an alıcı çözümleme bağlı olmadığından `skipped` event kaydeder.
- **TODO (gerçek e-posta için):**
  1. Gerçek bir e-posta sağlayıcısı yaz (`providers/email.provider.ts` doldur veya
     Medusa Notification modülü ekle) ve `service.ts` provider map'ine bağla.
  2. Abonelerde order → customer e-posta çözümlemesini bağla (recipient resolution).
  3. `order.created` / `order.canceled` için `message_type=transactional` template
     kayıtlarını ekle.

## Production güvenliği
- **Env fail-fast:** `src/lib/validate-env.ts`, `medusa-config.ts` içinde loadEnv
  sonrası çağrılır. Üretimde (`NODE_ENV=production`) eksik kritik env
  (`DATABASE_URL`, `JWT_SECRET`, `COOKIE_SECRET`, `STORE_CORS`, `ADMIN_CORS`,
  `AUTH_CORS`; iyzico açıksa API/secret/baseUrl) veya zayıf placeholder secret
  varsa süreç açık hata ile durur. Dev/test'te yalnız uyarır.
- **Secret:** kod içinde hardcode secret yok; tümü env'den okunur.
- **Health/readiness:** Medusa framework `GET /health` → 200 (doğrulandı).
- **CORS / URL:** `STORE_CORS` / `ADMIN_CORS` / `AUTH_CORS` env üzerinden config edilir.
- **Hard-delete koruması:** `src/scripts/salon-cleanup.ts` (create-medusa-app demo
  verisini siler) artık fail-closed: `SALON_DEMO_CLEANUP_CONFIRM=DELETE_CREATE_MEDUSA_DEMO_DATA`
  olmadan hiçbir şey silmez. Hiçbir npm script çağırmaz.

## Kalan gerçek blocker'lar
- **Ödeme (iyzico):** Provider skeleton hazır; network transport bilinçli olarak
  kapalı (`network_disabled` / `transport_not_implemented`). Gerçek merchant
  (vergi no + sandbox/prod credential) gelince `IYZICO_PROVIDER_ENABLED=true` +
  credential env + transport implementasyonu gerekir. Bu MVP kapsamı dışıdır.
- **Gerçek e-posta gönderimi:** yukarıdaki notification TODO tamamlanana kadar
  bildirimler simüle edilir.
