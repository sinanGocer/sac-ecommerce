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
