# Admin Türkçeleştirme & Markalama Runbook

## 1. Çekirdek arayüz Türkçe (resmi, yükseltme-güvenli)
Medusa Admin **resmi Türkçe çeviriyle** gelir (`@medusajs/dashboard` içinde
`tr.json`). Ürünler, kategoriler, koleksiyonlar, stok, varyantlar, fiyatlar,
siparişler, müşteriler, kullanıcılar, ayarlar, durumlar, filtreler, tablo
başlıkları, form alanları, butonlar, doğrulama/hata/başarı mesajları ve boş
durumların hepsi Türkçeleşir.

**Etkinleştirme (kullanıcı başına):**
1. Admin'e giriş yapın → sağ üst profil menüsü.
2. **Ayarlar → Profil → Dil (Language) → Türkçe** seçin.
3. Seçim kullanıcı profiline kaydedilir; sonraki girişlerde Türkçe kalır.

> Para birimi TRY otomatik **₺1.985,00** (binlik `.`, ondalık `,`) ve tarih
> `tr-TR` biçiminde gösterilir (locale Türkçe seçilince).

**Çekirdek için patch yapılmadı** (upstream paket dokunulmaz → Medusa
yükseltmeleri sorunsuz). Global "varsayılan dil = Türkçe" Medusa v2.16'da
desteklenen bir config DEĞİL; dil her kullanıcı için profilden seçilir. Tüm yeni
kullanıcılar için Türkçe varsayılan istenirse, kurulum sırasında her kullanıcının
dilini Türkçe yapın (tek seferlik).

## 2. Eklenti çevirileri (özel bileşenler)
Bu projeye eklenen admin widget/route metinleri `src/admin/i18n/json/{tr,en}.json`
dosyalarından gelir ve `src/admin/i18n/index.ts` ile kaydedilir. Yeni özel admin
metni eklerken bu dosyalara `tr` + `en` ekleyin ve `useTranslation()` kullanın.
Teknik alanlar (ID / SKU / EAN / handle) ÇEVRİLMEZ.

## 3. Markalama — "Sinan Koçer Profesyonel"
- **Yapıldı (güvenli, eklenti):** ürün listesi üstünde sade kurumsal marka şeridi
  (`src/admin/widgets/brand-banner.tsx`) — marka adı + kısa açıklama, i18n'li.
- **YapılMADI (upstream patch gerektirir → kural gereği dokunulmadı):**
  - Giriş ekranı başlığı / logosu
  - Tarayıcı sekme başlığı ("Medusa Admin") ve favicon
  - Global login arka planı
  Bunlar Medusa v2.16'da config ile değiştirilemez; ancak `@medusajs/dashboard`
  fork/eject veya build-sonrası asset değişimiyle yapılabilir (yükseltmeyi
  zorlaştırır). Talep edilirse ayrı, bilinçli bir adımda yapılmalıdır.

## 4. Catalog editor görünümü
- `catalog_editor` rolü yalnız **Products / Categories / Collections / Inventory**
  görür; diğer alanlar gizli + backend 403 (enforcement: `src/rbac/catalog-editor.ts`,
  testli). Owner/admin tam görünüm. Rol provisioning: `docs/catalog-editor-rbac-runbook.md`.
- Marka şeridi catalog editöre de görünür (ürün listesi).

## Doğrulama
- `npm run build` → "Frontend build completed successfully" (widget + i18n derlenir).
- Admin: `http://localhost:9000/app` → Ayarlar'dan Türkçe seçilebilir.
