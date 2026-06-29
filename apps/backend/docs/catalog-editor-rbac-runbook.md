# Catalog Editor RBAC — Operasyon Runbook

`catalog_editor` rolü; admin'de yalnız **Products / Categories / Collections /
Inventory** alanlarına izin verir. Order / Customer / Payment / Users / API keys /
Settings / Regions / Channels / Providers **gizlidir** ve doğrudan URL/API erişimi
backend tarafından **403** ile reddedilir (rol guard'ı; header/cookie ile rol
taklidi mümkün değildir — rol DB'den çözülür).

Tüm komutlar **dry-run varsayılan**; gerçek yazım için `CATALOG_EDITOR_RBAC_COMMIT=true`.

## 1. Admin kullanıcılarını ve rolleri listele (kullanıcı ID bulma)
```bash
cd apps/backend
CATALOG_EDITOR_RBAC_ACTION=list npm run catalog:editor-rbac:setup
# çıktı: her admin user'ın id + email; mevcut rbac rolleri; catalog_editor var mı
```

## 2. Yeni admin kullanıcı oluştur (Medusa CLI)
```bash
cd apps/backend
npx medusa user --email editor@example.com --password "<güçlü-parola>"
# sonra (1) ile user_id'yi bul
```

## 3. catalog_editor rolünü kur + kullanıcıya ata
```bash
# Önce dry-run (ne yapılacağını gösterir, yazım yok):
npm run catalog:editor-rbac:setup
# Commit (rol + policy + kullanıcı ataması):
CATALOG_EDITOR_RBAC_COMMIT=true CATALOG_EDITOR_USER_ID=<user_id> npm run catalog:editor-rbac:setup
```

## 4. Rolü kullanıcıdan kaldır
```bash
# dry-run:
CATALOG_EDITOR_RBAC_ACTION=remove CATALOG_EDITOR_USER_ID=<user_id> npm run catalog:editor-rbac:setup
# commit:
CATALOG_EDITOR_RBAC_ACTION=remove CATALOG_EDITOR_RBAC_COMMIT=true CATALOG_EDITOR_USER_ID=<user_id> npm run catalog:editor-rbac:setup
```

## 5. Güvenlik garantileri (testlerle doğrulanır: `npm run catalog:editor-rbac:test`)
- İzin verilen alanlar dışındaki admin route'lar **deny** (api keys/settings/regions/
  channels/shipping/fulfillment/payment/tax providers/custom/unknown → default deny).
- Owner/admin bypass tam erişimi korur; diğer roller Medusa RBAC'ye devreder.
- Privilege escalation yok; audit log hassas veri (PII/secret) içermez.

## Güvenlik notları
- Gerçek kullanıcı/rol ataması bu repoda YAPILMADI; yalnız araçlar + runbook hazır.
- `actor_id` audit için `CATALOG_EDITOR_ACTOR_ID` ile verilebilir (default "system").
- Komutlar idempotent: var olan rol/policy/atama tekrar yazılmaz.
