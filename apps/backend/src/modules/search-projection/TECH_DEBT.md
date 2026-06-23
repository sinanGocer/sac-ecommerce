# Teknik Borç — Test Altyapısı (Search Projection dışı)

Aşağıdaki sorunlar Search Projection'a **ait değildir**; mevcut proje test
altyapısından kaynaklanır. Bu adımda **yeniden yazılmadı**, yalnızca kayıt altına alındı.

## 1) Eksik `integration-tests/setup.js`
`jest.config.js` içinde `setupFiles: ["./integration-tests/setup.js"]` referansı var
ancak dosya repoda bulunmuyor. Bu yüzden `npm run test:unit` doğrudan çalıştırıldığında
"setupFiles ... was not found" doğrulama hatası verir.
- Olası çözüm (sonraki bir görevde, onayla): boş bir `integration-tests/setup.js`
  eklemek veya unit testler için `setupFiles`'ı koşullamak.

## 2) macOS/Linux SWC binary uyumsuzluğu
`@swc/jest` → `@swc/core` native binary platforma özeldir. `node_modules` macOS
için kurulduğundan farklı bir ortamda (ör. Linux CI/konteyner) "Failed to load
native binding" hatası olabilir.
- Olası çözüm (sonraki bir görevde): CI'da bağımlılıkların hedef platformda
  yeniden kurulması veya platform-bağımsız bir transform.

## Bu modülün testi nasıl doğrulandı
`projection-builder.ts` saf fonksiyon olduğundan, swc'siz olarak `tsc` ile JS'e
derlenip Node ile çalıştırıldı (14 assertion geçti). Birim test dosyası
(`__tests__/projection-builder.unit.spec.ts`) yazıldı ve tip-geçerli; yukarıdaki
altyapı sorunları giderildiğinde `npm run test:unit` ile koşulabilir.
