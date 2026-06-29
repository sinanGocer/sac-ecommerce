# Aveda Offline Kategori Keşfi — Kullanım Kılavuzu

Bu akış, Aveda'nın erişim engelini AŞMADAN, sizin tarayıcıdan kaydettiğiniz
kategori sayfalarından ürün URL'lerini otomatik çıkarır. **Ağ isteği yapılmaz,
DB değiştirilmez.**

## 1. Hangi Aveda kategori sayfalarını açmalısınız
Resmi sitede (giriş yaptığınız, normal tarayıcınızda) tüm ürün alanlarının
kategori/listeleme sayfalarını açın ve **"tümünü göster" / sonraki sayfalar**
dahil kaydırarak ürünlerin yüklendiğinden emin olun:
- Saç bakımı, Saç şekillendirme, Saç rengi, Saç derisi
- Erkek
- Cilt, Vücut, Aroma
- Setler / Seyahat boyları
- Varsa alt kategoriler ve sayfalama (page 2, 3, …)

> Not: Liste sayfası "sonsuz kaydırma" ise, kaydetmeden önce tüm ürünler
> görünene kadar aşağı kaydırın.

## 2. Safari / Chrome'da sayfayı HTML olarak nasıl kaydedersiniz
- **Safari:** Dosya → Farklı Kaydet… → Biçim: **"Sayfa Kaynağı" (Page Source)**
  veya **"Web Arşivi"** yerine **".html"** seçin. (Page Source / Kaynak yeterli.)
- **Chrome:** ⌘S (Dosya → Sayfayı Kaydet) → Tür: **"Web Sayfası, Yalnızca HTML"
  (Webpage, HTML Only)**.
- Her kategori/sayfa için ayrı bir `.html` dosyası oluşturun. Dosya adını anlamlı
  verin (ör. `sac-bakimi-1.html`, `erkek-1.html`) — bu ad audit'te
  `source_file` olarak görünür.

## 3. Dosyaları hangi klasöre koymalısınız
Kaydettiğiniz tüm `.html` dosyalarını şu klasöre koyun:

```
apps/backend/import-input/categories/
```

(Bu klasördeki `.html` dosyalarınız gitignore'dadır; repoya gönderilmez.)

## 4. Discovery dry-run komutu
```bash
cd apps/backend
npm run catalog:discovery:dry
# Farklı klasör:  DISCOVERY_INPUT_DIR=import-input/categories npm run catalog:discovery:dry
```

Çıktılar:
- **CSV:** `apps/backend/import-input/aveda-discovered-products.csv`
  (kolonlar: `url,external_id,source_file,discovery_reason`)
- **Rapor:** `apps/backend/assisted-import-reports/category-discovery-latest.json`
  (existing / new / duplicate / rejected sayıları)

## Sonraki adım (ayrı, bu fazda otomatik değil)
Discovery CSV'sini gözden geçirin; sonra ürün verisini (fiyat/görsel için)
**user-assisted import** akışıyla işleyin:
```bash
IMPORT_INPUT_FILE=import-input/aveda-discovered-products.csv npm run catalog:assisted-import:dry
```
Gerçek import yalnız ayrı `ASSISTED_IMPORT_COMMIT` + fingerprint onayı ile yapılır
(bu faz dry-run; DB yazımı 0).
