# Product Catalog Architecture Migration Plan

Status: idempotent category bootstrap ready. Product import remains disabled unless explicitly enabled.

Frozen modules:
- `customer-messaging-automation` is preserved as-is.
- Existing `product-sync` import flow is preserved as-is.

## Target Shape

Sinan Koçer Hair Store should use a multi-brand professional hair-care catalog:

```txt
Brand
└── Category
    └── Subcategory
        └── Products
```

Initial active brand:
- Aveda

Planned brands:
- Kerastase
- Olaplex
- Davines
- Kevin Murphy
- L'Oréal Professionnel

## Medusa Data Model

Use Medusa native `product_category` for the customer-facing category tree.

Recommended category metadata:

```ts
{
  catalog_kind: "brand" | "category" | "subcategory",
  brand: string,
  brand_slug: string,
  category_slug?: string,
  subcategory_slug?: string,
  managed_by: "product-catalog-architecture",
  source: "aveda.com" | "manual",
}
```

Use Medusa native `product.metadata` for product enrichment:

```ts
{
  brand: string,
  category: string,
  subcategory: string | null,
  hair_type: string[],
  concerns: string[],
  benefits: string[],
  size_ml: number | null,
  vegan: boolean | null,
  color_safe: boolean | null,
  ingredients: string | null,
  usage: string | null,
  description: string | null,
  is_gift_set: boolean,
  size_type: "travel" | "full_size" | null,
  limited_edition: boolean,
}
```

No new product table is required in the first phase.

## Optional Future Module

If admin-managed catalog governance is needed later, add a dedicated module:

```txt
src/modules/product-catalog/
  models/
    catalog-brand.ts
    catalog-category.ts
    catalog-product-profile.ts
```

Suggested tables:

### catalog_brand

- `id`
- `name`
- `slug`
- `status`: `active | planned | archived`
- `display_order`
- `metadata`

### catalog_category

- `id`
- `brand_slug`
- `name`
- `slug`
- `parent_slug`
- `level`: `brand | category | subcategory`
- `display_order`
- `medusa_category_id`
- `metadata`

### catalog_product_profile

- `id`
- `product_id`
- `brand_slug`
- `category_slug`
- `subcategory_slug`
- `hair_type`
- `concerns`
- `benefits`
- `size_ml`
- `vegan`
- `color_safe`
- `ingredients`
- `usage`
- `description`
- `metadata`

This optional module should be introduced only after the native Medusa category tree is stable.

## Migration Phases

### Phase 1: Plan and Seed Definitions

- Keep product import disabled.
- Keep existing `product-sync` category mapping untouched.
- Add catalog definition files under `src/product-catalog/architecture`.
- Review the Aveda tree and metadata fields.

### Phase 2: Category Bootstrap v2

- Add a new bootstrap script, separate from existing `sync:categories`.
- Create Medusa `product_category` records for:
  - brand root
  - categories
  - subcategories
- Store stable handles and metadata on category records.
- Use stable `external_id` values in the form `product-catalog:category:<brand>/<category>/<subcategory>`.
- Re-running the bootstrap must update existing managed records instead of creating duplicates.
- Do not delete legacy categories.

### Phase 3: Product Metadata Mapping

- Extend Product Sync metadata output to include:
  - `brand`
  - `category`
  - `subcategory`
  - `hair_type`
  - `concerns`
  - `benefits`
  - `size_ml`
  - `vegan`
  - `color_safe`
  - `ingredients`
  - `usage`
  - `description`
  - `is_gift_set`
  - `size_type`
  - `limited_edition`
- Keep old fields during transition:
  - `source_url`
  - `external_id`
  - `original_category_path`
  - `product_type`
  - `usage_category`
  - `hair_concern`
  - `collection`
  - `category_path`
  - `category_external_id`

### Phase 4: Dry-Run Validation

- Run product import in dry-run mode only.
- Compare old and new category paths.
- Keep unmatched products in review.
- Confirm no product writes happen.
- Keep `Hediye Setleri`, `Seyahat Boyları / Mini Ürünler`, and `Makyaj / Dudak` out of the category tree:
  - Gift sets are represented by `is_gift_set`.
  - Travel/full size is represented by `size_type`.
  - Limited drops are represented by `limited_edition`.
  - Makeup/lip products stay in manual review or explicit skip scope.

### Phase 5: Controlled Commit

- Import a small product batch only after manual review.
- Use existing Product Sync commit safeguards.
- Do not enable marketing or customer messaging flows.

## Aveda Category Tree

```txt
AVEDA
├─ Şampuan
│  ├─ Color Care
│  ├─ Blonde Care
│  ├─ Curly Hair
│  ├─ Scalp Care
│  ├─ Volume
│  ├─ Nutriplenish
│  ├─ Damage Repair
│  └─ Smooth / Anti-Frizz
├─ Saç Kremi
│  ├─ Color Care
│  ├─ Blonde Care
│  ├─ Curly Hair
│  ├─ Scalp Care
│  ├─ Volume
│  ├─ Nutriplenish
│  ├─ Damage Repair
│  └─ Smooth / Anti-Frizz
├─ Maske
│  ├─ Color Care
│  ├─ Curly Hair
│  ├─ Nutriplenish
│  ├─ Damage Repair
│  └─ Scalp Care
├─ Leave-In
│  ├─ Nemlendirme
│  ├─ Onarım
│  ├─ Isı Koruma
│  ├─ Bukle Belirginleştirme
│  └─ Smooth / Anti-Frizz
├─ Serum ve Yağlar
│  ├─ Saç Serumu
│  ├─ Saç Yağı
│  ├─ Scalp Serum
│  ├─ Nutriplenish
│  └─ Invati Advanced
├─ Şekillendirici
│  ├─ Sprey
│  ├─ Köpük
│  ├─ Krem
│  ├─ Wax
│  ├─ Jel
│  ├─ Tonik
│  ├─ Isı Koruyucu
│  └─ Erkek Şekillendirici
├─ Vücut Bakımı
│  ├─ El Bakımı
│  ├─ Ayak Bakımı
│  ├─ Duş Ürünleri
│  └─ Vücut Kremi
├─ Cilt Bakımı
│  ├─ Temizleyici
│  ├─ Serum
│  ├─ Nemlendirici
│  ├─ Tonik / Mist
│  ├─ Maske
│  ├─ Göz Bakımı
│  └─ Tıraş
├─ Aroma / Pure-Fume
│  ├─ Chakra Mist
│  └─ Aromatik Yağ
└─ Aksesuarlar
   ├─ Saç Fırçaları
   └─ Scalp Brush
```
