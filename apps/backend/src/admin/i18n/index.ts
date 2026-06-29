import en from "./json/en.json"
import tr from "./json/tr.json"

/**
 * Admin EKLENTİ çevirileri (widget/route'larımız için).
 *
 * NOT: Medusa Admin'in ÇEKİRDEK arayüzü (ürünler/siparişler/ayarlar vb.)
 * resmi `@medusajs/dashboard` paketinin kendi `tr` çevirisiyle gelir; kullanıcı
 * Ayarlar → Profil → Dil = Türkçe seçtiğinde tüm çekirdek UI Türkçeleşir. Bu
 * dosya yalnız bu projede eklenen özel admin bileşenlerinin metinlerini taşır
 * (upstream paket patch'lenmez → yükseltme güvenli).
 */
export default {
  tr: {
    translation: tr,
  },
  en: {
    translation: en,
  },
}
