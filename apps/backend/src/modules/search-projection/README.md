# Search Projection (iskelet — Adım 1)

PostgreSQL **source of truth** olarak kalır. Bu modül yalnızca **arama, filtreleme ve sıralama** için optimize edilmiş **hafif** bir görünüm (projection) üretir. İkinci bir source-of-truth oluşturmaz; veriyi Medusa ürününden + metadata'dan türetir.

## Bu adımda olanlar
- `search-projection.types.ts` — projection tipi/sözleşmesi, sabitler, alan-kaynak haritası.
- `projection-builder.ts` — **saf** (yan etkisiz) dönüştürücü; test edilebilir, N+1 üretmez.
- `model-plan.ts` — gelecekteki tablo/index ve cache-key planı (yalnızca dokümantasyon).
- `scripts/search-backfill.ts` — **yalnızca dry-run**; batch okur, projection üretir, JSON rapor yazar. **DB'ye yazmaz.**
- `__tests__/projection-builder.unit.spec.ts` — birim testler.

## Bu adımda BİLEREK YAPILMADI
- Medusa `Module()` + canlı `model.define` ve **migration / tablo**.
- `subscriber` / event listener.
- read API, Redis/Typesense bağlantısı, UI.
- Bu modül `medusa-config.ts`'e **eklenmedi** → Medusa tarafından yüklenmez, mevcut yapıya etkisi yoktur.

## Kaynağı henüz olmayan alanlar
`average_rating, review_count, weekly_sales_score, monthly_sales_score, all_time_sales_score, favorite_score, trending_score` → uydurulmaz; `NO_SOURCE_DEFAULTS` ile `null`/`0` işaretlenir. Reviews / Sales-Ranking / Favorites sistemleri kurulunca beslenecektir.

## Dry-run
```bash
cd apps/backend
npm run search:backfill:dry
# rapor: search-reports/search-backfill-latest.json
```
