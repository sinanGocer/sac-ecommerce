# Lot Costing, Kâr-Zarar, Tavsiye Fiyat, Talep Tahmini & Stok Önerisi

Bu paket **veri modeli + saf hesaplama motoru** sağlar. Gerçek stok girişi, FIFO
canlı tüketimi, fiyat/stok mutation'ı, satın alma ve **migration ÇALIŞTIRMA bu
fazda YAPILMADI** (görev kuralı). Varsayılan: yalnız öneri/dry-run.

## Veri modeli (Medusa modülü `src/modules/lot-costing/`)
9 entity: `purchase_receipt`, `inventory_cost_lot`, `cost_allocation`,
`cost_adjustment`, `lot_product_pricing_policy`, `demand_forecast_snapshot`,
`inventory_planning_policy`, `reorder_recommendation`, `forecast_accuracy`.
Para alanları `bigNumber` (float yuvarlama yok). Hard delete yok; düzeltmeler
ters kayıt/audit ile. Modül `medusa-config.ts`'e kayıtlı.

### Migration
`npx medusa db:generate lotCosting` ile migration üretildi
(`src/modules/lot-costing/migrations/Migration*.ts`) — **UYGULANMADI**.
Local/staging'de uygulamak için (production'da DEĞİL):
```bash
npx medusa db:migrate
```
Migration yalnız yeni tablolar oluşturur; mevcut 74 ürünün stok/fiyatına
dokunmaz. Mevcut stoklar maliyet girilene kadar `unvalued_opening_stock` olarak
işaretlenir; maliyet girilmeden gerçek kâr raporu üretilmez.

## Saf hesaplama motoru (`src/inventory-costing/`, testli)
- **FIFO** (`fifo.ts`): en eski kalan lot önce; tek satış birden çok lota bölünür;
  oversell fail-closed; iptal/iade `reverseAllocation` ile özgün lotlara döner
  (idempotent — aynı reversal iki kez uygulanmaz). + weighted average + son alış.
- **Kâr-zarar** (`profit.ts`): brüt/net gelir, KDV, komisyon, kargo, paketleme,
  operasyon, refund → brüt/net kâr + marj + zarar bayrağı.
- **Tavsiye fiyat** (`recommended-price.ts`): efektif maliyet + KDV + komisyon +
  giderler + min kâr/marj → minimum güvenli fiyat; hedef marj → önerilen fiyat.
  FIFO/ağırlıklı/son-alış tabanlarının her biri için; **varsayılan öneri = en
  yüksek taban** (zarar riskini önler). Yuvarlama: tam TL / x,90 / x,99 / adım.
- **Talep tahmini** (`forecast.ts`): açıklanabilir WMA + üssel düzleştirme + trend
  + stockout correction; canceled/test/refund ve stoksuz günler gerçek talep
  sayılmaz; cold-start (manuel aylık / kategori medyanı, düşük confidence).
- **Stok önerisi** (`reorder.ts`): `reorder_point = lead_time_demand + safety_stock`,
  `recommended_quantity = target_stock − available − inbound` (MOQ/kat yuvarlama,
  maximum_stock_days cap, perishable guard, düşük-confidence→uyarı, negatif→0,
  tahmini bütçe). Gerçek PO oluşturmaz.
- **Doğruluk** (`accuracy.ts`): MAE / MAPE / bias.
- **Redaction** (`redaction.ts`): catalog_editor'a maliyet/tedarikçi/kâr alanları
  payload'dan **silinir** (API katmanı); owner/admin tam görür.

Test: `npm run inventory:costing:test` (44 assertion).

## Yetki farkı (API katmanında uygulanacak)
- **owner/admin:** geliş fiyatı, lot, tedarikçi, kâr-zarar, stok değeri görür;
  stok girişi, maliyet düzeltmesi, politika, öneri onayı, fiyata öneri uygulama.
- **catalog_editor:** mevcut stok + satış hızı + önerilen miktarı görür; satış
  fiyatı/ürün/kategori düzenler; geliş fiyatı/tedarikçi/fatura/net kâr/stok
  değeri/maliyet politikası GÖRMEZ/DEĞİŞTİREMEZ. `redactForRole` ile response
  redaksiyonu + RBAC guard (`src/rbac/catalog-editor.ts`).

## Bu fazda YAPILMAYANLAR (sonraki onaylı adımlar)
1. Migration'ı çalıştırma (db:migrate).
2. Stok-giriş workflow'u (transaction + idempotency → lot + Medusa inventory artışı).
3. Sipariş tamamlanınca order→FIFO allocation subscriber'ı; iptal/iade reversal.
4. Admin API route'ları (redaction + RBAC) ve Admin UI (Stok/Maliyet Partileri,
   Talep & Stok Planlama, dashboard badge'leri/butonları).
5. Günlük/haftalık forecast + reorder + accuracy job'ları (idempotent, audit).

Hesaplama motoru hazır olduğundan bu katmanlar motoru çağıran ince IO sarmalları
olacaktır.

## GÜNCEL DURUM — Operasyonel (atomik workflow)

Migration local DB'de uygulandı; veri modeli + hesaplama motoru + Admin
ekranları + read/write API'ları + FIFO subscriber'ları + job'lar mevcut.
Stok girişi artık **atomik workflow** ile yapılır (`src/workflows/lot-costing/
create-stock-entry.ts`): receipt → lot → inventory artışı → audit, her adım
**compensation'lı**; herhangi bir adım hata verirse önceki adımlar geri alınır
(soft-state; hard delete yok). Idempotency_key zaten varsa yeni kayıt/stok
artışı yok. `POST /admin/lot-costing/stock-entry` bu workflow'u çağırır.

### Feature flag açma sırası (production)
1. **Açılış maliyet lotları:** `GET /admin/lot-costing/opening-stock` ile
   maliyetsiz (UNVALUED) varyantları listele; her stoklu varyant için
   `LOT_COSTING_WRITE_ENABLED=true` ile gerçek stok girişi yap.
2. **Doğrula:** opening-stock raporu boşalmalı (maliyetsiz varyant kalmamalı).
3. **FIFO'yu aç:** `LOT_COSTING_FIFO_ENABLED=true`. **Maliyetsiz stok varken
   FIFO açma** (allocation maliyetsiz lota düşer / oversell fail-closed olur).
4. **Job'ları aç:** `LOT_COSTING_JOBS_ENABLED=true` (öneri-only; PO/fiyat/stok
   mutation yok).

### İlk gerçek stok girişinden önce kontrol listesi
- [ ] `LOT_COSTING_WRITE_ENABLED=true` yalnız gerekli ortamda.
- [ ] variant + location_id + inventory_item_id doğru.
- [ ] idempotency_key benzersiz (tekrar = no-op).
- [ ] owner/admin ile çağrılıyor (catalog_editor → 403).

### Rollback / compensation davranışı
- Lot oluşturma başarısız → receipt geri alınır.
- Inventory artışı başarısız → lot + receipt geri alınır.
- Audit yalnız başarılı commit sonrası üretilir (başarısızlıkta audit yok).

### Sorun halinde flag kapatma (kill-switch)
İlgili `LOT_COSTING_*` flag'ini `false` yap + servisi yeniden başlat →
stock-entry 503, FIFO subscriber no-op, job no-op. Mevcut yazılmış lot/allocation
KORUNUR (silinmez); yalnız yeni işlemler durur.

## KALAN PRODUCTION-GRADE AÇIKLAR (dürüst)
1. **FIFO eşzamanlılık (concurrency) garantisi:** mevcut FIFO apply idempotent +
   oversell plan-seviyesinde fail-closed; ANCAK iki eşzamanlı siparişin AYNI lotu
   fazla tüketmesini kesin engellemek için lot `remaining_quantity` güncellemesi
   **satır kilidiyle** yapılmalı. Kural gereği raw SQL ve process-mutex yasak;
   doğru çözüm: MikroORM **pessimistic write lock** (`lockMode`, raw SQL DEĞİL) ya
   da Medusa **inventory reservation** sistemini otoriter oversell guard'ı olarak
   kullanmak. Bu, model/servis seviyesinde ek bir uygulama adımıdır (henüz YOK).
2. **Canlı integration test DB:** `jest.config.js` `integration-tests/setup.js`
   bekliyor (mevcut değil) ve `.env.test` yok; bu ortamda izole test DB runner'ı
   kurulmadı/çalıştırılmadı. Atomik rollback + concurrency davranışı bu yüzden
   **canlı integration testleriyle doğrulanmadı** (saf yazma mantığı 65 unit
   assertion ile test edildi). CI/uygun ortamda `medusaIntegrationTestRunner` ile
   stok-giriş rollback + FIFO concurrency testleri eklenmelidir.

Bu iki madde tamamlanana kadar sistem **PRODUCTION_READY sayılmaz**; flag'ler
kapalı kaldığı sürece mevcut veriye dokunmaz.
