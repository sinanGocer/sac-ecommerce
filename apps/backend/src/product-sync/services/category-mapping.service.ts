import {
  ProductCategoryPath,
  ProductSyncMetadata,
  RawProduct,
} from "../types/product-sync.types"
import {
  BrandTaxonomyDefinition,
  CategoryNodeDefinition,
} from "../taxonomies/brand-taxonomy"
import {
  PRODUCT_CATALOG_TREES,
  ProductCatalogTree,
  productCatalogCategoryExternalId,
} from "../../product-catalog/architecture"

type Rule = {
  path: string[]
  includes?: string[]
  all?: string[]
}

const AVEDA_RULES: Rule[] = [
  {
    path: ["Cilt Bakımı", "Tıraş"],
    includes: ["tiras", "shave", "shaving"],
  },
  {
    path: ["Cilt Bakımı", "Göz Bakımı"],
    includes: ["goz-kremi", "eye-cream", "eye cream"],
  },
  {
    path: ["Cilt Bakımı", "Maske"],
    includes: ["cilt-bakimi/yuz-maskesi", "skin-care/masques", "wedding-masque", "face-mask"],
  },
  {
    path: ["Cilt Bakımı", "Temizleyici"],
    includes: [
      "yuz-temizleyici",
      "temizleme-kopugu",
      "skin-care/cleanser",
      "arndrc-tonik",
    ],
  },
  {
    path: ["Cilt Bakımı", "Serum"],
    includes: ["yuz-serumu", "skin-care/serum", "kas-dolgunlastrc"],
  },
  {
    path: ["Cilt Bakımı", "Tonik / Mist"],
    includes: ["cilt-bakimi/tonik", "yuz-misti", "face-mist"],
  },
  {
    path: ["Cilt Bakımı", "Nemlendirici"],
    includes: [
      "yuz-nemlendirici",
      "moisturizer",
      "bakim-losyonu",
      "yuz-losyonu",
      "gece-kremi",
      "morning-creme",
      "sut-losyon",
    ],
  },
  {
    path: ["Aroma / Pure-Fume", "Chakra Mist"],
    includes: ["chakra-vucut-misti", "cakra-vucut-misti", "chakra"],
  },
  {
    path: ["Aroma / Pure-Fume", "Aromatik Yağ"],
    includes: [
      "aromatik-vucut-yag",
      "aromatik-sac-ve-vucut-yagi",
      "essential-oil",
      "esansiyel-yag",
      "pure-fume-aromasi",
      "cooling-rahatlatc-aromatik",
    ],
  },
  {
    path: ["Aksesuarlar", "Scalp Brush"],
    includes: ["scalp-brush", "exfoliating-scalp-brush"],
  },
  {
    path: ["Aksesuarlar", "Saç Fırçaları"],
    includes: ["sac-frcas", "sac-fircasi", "hair-brush"],
  },
  {
    path: ["Vücut Bakımı", "Vücut Kremi"],
    includes: [
      "vucut-losyonu",
      "vucut-kremi",
      "body-lotion",
      "body-cream",
      "vucut-nemlendirici-krem",
    ],
  },
  {
    path: ["Vücut Bakımı", "El Bakımı"],
    includes: ["el-bakim", "hand", "hand-relief", "el-kremi"],
  },
  {
    path: ["Vücut Bakımı", "Ayak Bakımı"],
    includes: ["ayak", "foot", "foot-relief", "ayak-kremi"],
  },
  {
    path: ["Vücut Bakımı", "Duş Ürünleri"],
    includes: ["dus", "vucut-temizleyici", "body-wash", "body cleanser"],
  },
  {
    path: ["Şekillendirici", "Isı Koruyucu"],
    includes: ["isidan", "isi-koruyucu", "heat", "thermal", "gunes-koruyucusu"],
  },
  {
    path: ["Şekillendirici", "Erkek Şekillendirici"],
    includes: ["erkek-sac-sekillendirme"],
  },
  {
    path: ["Şekillendirici", "Sprey"],
    includes: ["sprey", "spray", "mist"],
  },
  {
    path: ["Şekillendirici", "Köpük"],
    includes: ["kopuk", "foam", "mousse"],
  },
  {
    path: ["Şekillendirici", "Wax"],
    includes: ["wax", "pomad", "paste", "macun"],
  },
  {
    path: ["Şekillendirici", "Jel"],
    includes: ["jel", "gel"],
  },
  {
    path: ["Şekillendirici", "Tonik"],
    includes: ["sac-tonik", "tonic", "tonik"],
  },
  {
    path: ["Şekillendirici", "Krem"],
    includes: ["bukle-belirginlestirici-krem"],
  },
  {
    path: ["Şekillendirici", "Krem"],
    all: ["sekillendir", "krem"],
  },
  {
    path: ["Leave-In", "Isı Koruma"],
    includes: ["isi-koruma", "heat-protect", "thermal-protect"],
  },
  {
    path: ["Leave-In", "Bukle Belirginleştirme"],
    includes: ["durulanmayan-mist"],
  },
  {
    path: ["Leave-In", "Onarım"],
    includes: [
      "split-end-repair",
      "daily-hair-repair",
      "durulanmayan-onar",
      "durulanmayan-sac-onarim",
    ],
  },
  {
    path: ["Leave-In", "Smooth / Anti-Frizz"],
    all: ["durulanmayan", "smooth"],
  },
  {
    path: ["Leave-In", "Nemlendirme"],
    includes: [
      "gunluk-sac-nemlendirici-bakim",
      "gunluk-sac-nemlendirici-bakm",
      "daily-moisturizing-treatment",
      "leave-in",
    ],
  },
  {
    path: ["Leave-In", "Nemlendirme"],
    all: ["durulanmayan", "nemlendirici"],
  },
  {
    path: ["Şampuan", "Volume"],
    includes: [
      "kalinlastirici",
      "invati-advanced-sac-dokulmesine-kars-bakim-seti",
      "invati-advanced-sac-dokulmesine-kars-bakm-seti",
    ],
  },
  {
    path: ["Şampuan", "Color Care"],
    all: ["sampuan", "color"],
  },
  {
    path: ["Şampuan", "Color Care"],
    all: ["shampoo", "color"],
  },
  {
    path: ["Şampuan", "Blonde Care"],
    all: ["sampuan", "blonde"],
  },
  {
    path: ["Şampuan", "Blonde Care"],
    all: ["shampoo", "blonde"],
  },
  {
    path: ["Şampuan", "Blonde Care"],
    all: ["sampuan", "mor"],
  },
  {
    path: ["Şampuan", "Curly Hair"],
    all: ["sampuan", "bukle"],
  },
  {
    path: ["Şampuan", "Curly Hair"],
    all: ["shampoo", "curly"],
  },
  {
    path: ["Şampuan", "Scalp Care"],
    includes: ["purifying-scalp-cleanser"],
  },
  {
    path: ["Şampuan", "Scalp Care"],
    all: ["sampuan", "scalp"],
  },
  {
    path: ["Şampuan", "Scalp Care"],
    all: ["shampoo", "scalp"],
  },
  {
    path: ["Şampuan", "Scalp Care"],
    all: ["sampuan", "derisi"],
  },
  {
    path: ["Şampuan", "Volume"],
    all: ["sampuan", "hacim"],
  },
  {
    path: ["Şampuan", "Volume"],
    all: ["shampoo", "volume"],
  },
  {
    path: ["Şampuan", "Nutriplenish"],
    all: ["sampuan", "nutriplenish"],
  },
  {
    path: ["Şampuan", "Nutriplenish"],
    all: ["shampoo", "nutriplenish"],
  },
  {
    path: ["Şampuan", "Damage Repair"],
    all: ["sampuan", "repair"],
  },
  {
    path: ["Şampuan", "Damage Repair"],
    all: ["shampoo", "repair"],
  },
  {
    path: ["Şampuan", "Damage Repair"],
    all: ["sampuan", "onarm"],
  },
  {
    path: ["Şampuan", "Smooth / Anti-Frizz"],
    all: ["sampuan", "smooth"],
  },
  {
    path: ["Şampuan", "Smooth / Anti-Frizz"],
    all: ["shampoo", "smooth"],
  },
  {
    path: ["Şampuan"],
    includes: ["sampuan", "shampoo"],
  },
  {
    path: ["Saç Kremi", "Color Care"],
    all: ["sac-kremi", "color"],
  },
  {
    path: ["Saç Kremi", "Color Care"],
    all: ["conditioner", "color"],
  },
  {
    path: ["Saç Kremi", "Blonde Care"],
    all: ["sac-kremi", "blonde"],
  },
  {
    path: ["Saç Kremi", "Blonde Care"],
    all: ["conditioner", "blonde"],
  },
  {
    path: ["Saç Kremi", "Curly Hair"],
    all: ["sac-kremi", "bukle"],
  },
  {
    path: ["Saç Kremi", "Curly Hair"],
    all: ["conditioner", "curly"],
  },
  {
    path: ["Saç Kremi", "Curly Hair"],
    includes: ["co-wash"],
  },
  {
    path: ["Saç Kremi", "Scalp Care"],
    all: ["sac-kremi", "scalp"],
  },
  {
    path: ["Saç Kremi", "Scalp Care"],
    all: ["conditioner", "scalp"],
  },
  {
    path: ["Saç Kremi", "Volume"],
    all: ["sac-kremi", "hacim"],
  },
  {
    path: ["Saç Kremi", "Volume"],
    all: ["conditioner", "volume"],
  },
  {
    path: ["Saç Kremi", "Nutriplenish"],
    all: ["sac-kremi", "nutriplenish"],
  },
  {
    path: ["Saç Kremi", "Nutriplenish"],
    all: ["conditioner", "nutriplenish"],
  },
  {
    path: ["Saç Kremi", "Damage Repair"],
    all: ["sac-kremi", "repair"],
  },
  {
    path: ["Saç Kremi", "Damage Repair"],
    all: ["conditioner", "repair"],
  },
  {
    path: ["Saç Kremi", "Damage Repair"],
    includes: ["yipranmis-saclar-icin-onarim-kremi"],
  },
  {
    path: ["Saç Kremi", "Smooth / Anti-Frizz"],
    all: ["sac-kremi", "smooth"],
  },
  {
    path: ["Saç Kremi", "Smooth / Anti-Frizz"],
    all: ["conditioner", "smooth"],
  },
  {
    path: ["Saç Kremi"],
    includes: ["sac-kremi", "conditioner"],
  },
  {
    path: ["Maske", "Color Care"],
    all: ["maske", "color"],
  },
  {
    path: ["Maske", "Curly Hair"],
    all: ["maske", "bukle"],
  },
  {
    path: ["Maske", "Nutriplenish"],
    all: ["maske", "nutriplenish"],
  },
  {
    path: ["Maske", "Damage Repair"],
    includes: [
      "intensive-restructuring-treatment",
      "yogun-yeniden-yapilandirici-bakim",
    ],
  },
  {
    path: ["Maske", "Damage Repair"],
    all: ["maske", "repair"],
  },
  {
    path: ["Maske", "Scalp Care"],
    all: ["maske", "scalp"],
  },
  {
    path: ["Maske"],
    includes: ["maske", "mask"],
  },
  {
    path: ["Serum ve Yağlar", "Scalp Serum"],
    includes: ["scalp-revitalizer", "scalp-concentrate", "sac-derisi"],
  },
  {
    path: ["Serum ve Yağlar", "Invati Advanced"],
    all: ["serum", "invati"],
  },
  {
    path: ["Serum ve Yağlar", "Nutriplenish"],
    all: ["serum", "nutriplenish"],
  },
  {
    path: ["Serum ve Yağlar", "Saç Yağı"],
    includes: ["sac-yag", "sac-bakim-yagi", "hair-oil"],
  },
  {
    path: ["Serum ve Yağlar", "Saç Serumu"],
    includes: ["serum"],
  },
  {
    path: ["Serum ve Yağlar"],
    includes: ["yag", "oil"],
  },
]

const RULES_BY_BRAND: Record<string, Rule[]> = {
  aveda: AVEDA_RULES,
}

export class CategoryMappingService {
  resolve(product: RawProduct): ProductCategoryPath | null {
    const catalog = this.catalogForBrand(product.brand)
    if (!catalog) return null
    if (this.isUnsupportedCategoryRoot(product.category)) return null

    const haystack = this.normalize(
      [
        product.category,
        product.subCategory,
        product.name,
        product.sourceUrl,
      ]
        .filter(Boolean)
        .join(" ")
    )

    const rule = (RULES_BY_BRAND[catalog.brand.slug] ?? []).find(
      (candidate) =>
        this.matchesRule(haystack, candidate) &&
        this.isAllowedForSourceRoot(product.category, candidate)
    )

    if (!rule) return null

    const path = rule.path
    const leaf = path[path.length - 1]

    return {
      brand: catalog.brand.name,
      path,
      leaf,
      externalId: productCatalogCategoryExternalId([
        catalog.brand.slug,
        ...this.slugsForCatalogPath(catalog, path),
      ]),
    }
  }

  buildMetadata(product: RawProduct): ProductSyncMetadata {
    const categoryPath = this.resolve(product)
    const text = this.searchText(product)

    return {
      brand: product.brand,
      category: categoryPath?.path[0] ?? null,
      subcategory: categoryPath?.path[1] ?? null,
      hair_type: this.resolveHairTypes(text),
      concerns: this.resolveConcerns(text),
      benefits: this.resolveBenefits(text),
      size_ml: this.resolveSizeMl(product.volume),
      vegan: this.resolveVegan(text),
      color_safe: this.resolveColorSafe(text),
      ingredients: product.ingredients,
      usage: product.usage,
      is_gift_set: this.resolveIsGiftSet(text),
      size_type: this.resolveSizeType(text, product.volume),
      limited_edition: this.resolveLimitedEdition(text),
      source_url: product.sourceUrl,
      external_id: product.externalId,
      original_category_path: this.originalCategoryPath(product),
      product_type: this.resolveProductType(text),
      usage_category: this.resolveUsageCategory(text),
      hair_type_primary: this.resolveHairType(text),
      hair_concern: this.resolveHairConcern(text),
      collection: this.resolveCollection(text),
      category_path: categoryPath
        ? [categoryPath.brand, ...categoryPath.path].join(" > ")
        : null,
      category_external_id: categoryPath?.externalId ?? null,
    }
  }

  private catalogForBrand(brand: string): ProductCatalogTree | null {
    return PRODUCT_CATALOG_TREES[this.normalize(brand)] ?? null
  }

  private isUnsupportedCategoryRoot(category: string | null): boolean {
    const normalized = this.normalize(category ?? "")
    return [
      "makyaj",
      "makeup",
    ].includes(normalized)
  }

  private isBodyCategoryRoot(category: string | null): boolean {
    const normalized = this.normalize(category ?? "")
    return normalized === "vucut-bakim" || normalized === "body"
  }

  private isAllowedForSourceRoot(
    category: string | null,
    rule: Rule
  ): boolean {
    if (!this.isBodyCategoryRoot(category)) return true

    return ["Vücut Bakımı", "Aroma / Pure-Fume"].includes(rule.path[0])
  }

  private matchesRule(text: string, rule: Rule): boolean {
    const anyMatch =
      !rule.includes ||
      rule.includes.some((token) => text.includes(this.normalize(token)))
    const allMatch =
      !rule.all || rule.all.every((token) => text.includes(this.normalize(token)))
    return anyMatch && allMatch
  }

  private slugsForPath(
    taxonomy: BrandTaxonomyDefinition,
    path: string[]
  ): string[] {
    const slugs: string[] = []
    let children = taxonomy.root.children ?? []

    for (const segment of path) {
      const match = children.find((node) => node.name === segment)
      if (!match) break
      slugs.push(match.slug)
      children = match.children ?? []
    }

    return slugs
  }

  private slugsForCatalogPath(
    catalog: ProductCatalogTree,
    path: string[]
  ): string[] {
    const slugs: string[] = []
    let children = catalog.categories

    for (const segment of path) {
      const match = children.find((node) => node.name === segment)
      if (!match) break
      slugs.push(match.slug)
      children = match.children ?? []
    }

    return slugs
  }

  private normalize(value: string): string {
    const map: Record<string, string> = {
      ç: "c",
      ğ: "g",
      ı: "i",
      ö: "o",
      ş: "s",
      ü: "u",
      Ç: "c",
      Ğ: "g",
      İ: "i",
      Ö: "o",
      Ş: "s",
      Ü: "u",
    }

    return value
      .replace(/[çğıöşüÇĞİÖŞÜ]/g, (ch) => map[ch] ?? ch)
      .toLowerCase()
  }

  private searchText(product: RawProduct): string {
    return this.normalize(
      [
        product.category,
        product.subCategory,
        product.name,
        product.shortDescription,
        product.longDescription,
        product.usage,
        product.ingredients,
        product.sourceUrl,
      ]
        .filter(Boolean)
        .join(" ")
    )
  }

  private originalCategoryPath(product: RawProduct): string | null {
    const parts = [product.brand, product.category, product.subCategory].filter(
      Boolean
    )
    return parts.length > 0 ? parts.join(" > ") : null
  }

  private resolveProductType(text: string): string | null {
    return this.firstMatch(text, [
      ["hand_cream", ["hand-relief", "el-kremi", "hand"]],
      ["foot_cream", ["foot-relief", "ayak-kremi", "foot"]],
      ["body_wash", ["dus", "body-wash", "vucut-temizleyici"]],
      ["body_lotion", ["vucut-losyonu", "body-lotion", "body lotion"]],
      ["body_cream", ["vucut-kremi", "body-cream", "body cream"]],
      ["hair_brush", ["sac-fircasi", "sac-frcas", "hair-brush", "brush"]],
      ["aroma", ["pure-fume", "aromatik", "chakra", "cakra"]],
      ["skin_care", ["cilt-bakimi", "skin-care", "yuz", "face"]],
      ["shampoo", ["sampuan", "shampoo"]],
      ["conditioner", ["sac-kremi", "conditioner"]],
      ["mask", ["maske", "mask"]],
      ["leave_in", ["leave-in", "durulanmayan", "split-end-repair"]],
      ["serum_oil", ["serum", "yag", "oil"]],
      ["tonic", ["tonik", "tonic"]],
      ["spray", ["sprey", "spray"]],
      ["foam_mousse", ["kopuk", "mousse", "foam"]],
      ["cream", ["krem", "cream"]],
      ["wax", ["wax", "pomad", "paste"]],
    ])
  }

  private resolveUsageCategory(text: string): string | null {
    return this.firstMatch(text, [
      ["body_care", ["vucut", "body", "hand", "foot", "el-bakim", "ayak"]],
      ["skin_care", ["cilt-bakimi", "skin-care", "yuz", "face", "tiras"]],
      ["aroma", ["pure-fume", "aromatik", "chakra", "cakra"]],
      ["cleansing", ["sampuan", "shampoo", "dus", "cleanser", "temizleyici"]],
      ["conditioning", ["conditioner", "sac-kremi"]],
      ["treatment", ["maske", "mask", "treatment", "bakim"]],
      ["leave_in", ["leave-in", "durulanmayan"]],
      ["styling", ["sekillendirme", "styling", "sprey", "spray", "foam", "wax"]],
    ])
  }

  private resolveHairType(text: string): string | null {
    return this.firstMatch(text, [
      ["blonde", ["blonde", "sari", "mor-sampuan"]],
      ["color_treated", ["color", "renk", "boyal"]],
      ["curly", ["curly", "bukle", "kivircik"]],
      ["fine_thin", ["hacim", "volume", "dolgun", "ince-telli"]],
      ["all_hair_types", ["tum-sac", "all-hair", "her-sac"]],
    ])
  }

  private resolveHairTypes(text: string): string[] {
    return this.allMatches(text, [
      ["blonde", ["blonde", "sari", "mor-sampuan"]],
      ["color_treated", ["color", "renk", "boyal"]],
      ["curly", ["curly", "bukle", "kivircik"]],
      ["fine_thin", ["hacim", "volume", "dolgun", "ince-telli"]],
      ["dry", ["kuru", "dry"]],
      ["all_hair_types", ["tum-sac", "all-hair", "her-sac"]],
    ])
  }

  private resolveHairConcern(text: string): string | null {
    return this.firstMatch(text, [
      ["heat_protection", ["isidan", "isi-koruyucu", "heat", "thermal"]],
      ["color_protection", ["color", "renk", "boyal", "renk-koruma"]],
      ["volume", ["volume", "hacim", "dolgun"]],
      ["scalp", ["scalp", "deri", "kepek"]],
      ["curl_definition", ["curly", "bukle", "kivircik"]],
      ["dryness_hydration", ["nem", "hydration", "moisture", "dry"]],
      ["damage_repair", ["repair", "onar", "yipran", "botanical-repair"]],
      ["frizz_smoothing", ["smooth", "frizz", "pürüzsüz", "puruzsuz"]],
    ])
  }

  private resolveConcerns(text: string): string[] {
    return this.allMatches(text, [
      ["heat_protection", ["isidan", "isi-koruyucu", "heat", "thermal"]],
      ["color_protection", ["color", "renk", "boyal", "renk-koruma"]],
      ["volume", ["volume", "hacim", "dolgun", "kalinlastirici"]],
      ["scalp", ["scalp", "deri", "kepek"]],
      ["curl_definition", ["curly", "bukle", "kivircik"]],
      ["dryness_hydration", ["nem", "hydration", "moisture", "dry", "kuru"]],
      ["damage_repair", ["repair", "onar", "yipran", "botanical-repair"]],
      ["frizz_smoothing", ["smooth", "frizz", "elektriklen", "puruzsuz"]],
    ])
  }

  private resolveBenefits(text: string): string[] {
    return this.allMatches(text, [
      ["cleansing", ["sampuan", "shampoo", "temizleyici", "cleanser"]],
      ["conditioning", ["conditioner", "sac-kremi", "yumusatici"]],
      ["moisturizing", ["nem", "hydration", "moisture", "nemlendirici"]],
      ["repairing", ["repair", "onar", "yipran"]],
      ["shine", ["parlak", "shine", "isilt"]],
      ["volume", ["volume", "hacim", "dolgun"]],
      ["smoothing", ["smooth", "elektriklen", "puruzsuz"]],
      ["curl_definition", ["bukle", "curly"]],
      ["scalp_care", ["scalp", "sac-derisi", "derisi"]],
      ["heat_protection", ["isidan", "isi-koruyucu", "heat"]],
      ["color_safe", ["color", "renk", "boyal"]],
      ["styling_hold", ["tutus", "hold", "sekillendirici"]],
    ])
  }

  private resolveSizeMl(volume: string | null): number | null {
    if (!volume) return null
    const normalized = this.normalize(volume).replace(",", ".")
    const match = normalized.match(/(\d+(?:\.\d+)?)\s*ml/)
    if (!match) return null
    const parsed = Number(match[1])
    return Number.isFinite(parsed) ? parsed : null
  }

  private resolveVegan(text: string): boolean | null {
    if (text.includes("vegan")) return true
    return null
  }

  private resolveColorSafe(text: string): boolean | null {
    if (
      text.includes("color") ||
      text.includes("renk") ||
      text.includes("boyal") ||
      text.includes("colour")
    ) {
      return true
    }
    return null
  }

  private resolveIsGiftSet(text: string): boolean {
    return [
      "set",
      "gift-set",
      "hediye",
      "bakim-seti",
      "bakm-seti",
    ].some((token) => text.includes(this.normalize(token)))
  }

  private resolveSizeType(
    text: string,
    volume: string | null
  ): "travel" | "full_size" | null {
    if (
      ["mini", "travel", "seyahat", "travel-size", "mini-boy"].some((token) =>
        text.includes(this.normalize(token))
      )
    ) {
      return "travel"
    }

    const sizeMl = this.resolveSizeMl(volume)
    if (sizeMl !== null) {
      return sizeMl <= 100 ? "travel" : "full_size"
    }

    return null
  }

  private resolveLimitedEdition(text: string): boolean {
    return ["limited-edition", "limited edition", "sinirli", "özel seri"].some(
      (token) => text.includes(this.normalize(token))
    )
  }

  private resolveCollection(text: string): string | null {
    return this.firstMatch(text, [
      ["botanical_repair", ["botanical-repair", "botanical repair"]],
      ["nutriplenish", ["nutriplenish"]],
      ["invati_advanced", ["invati-advanced", "invati advanced"]],
      ["be_curly", ["be-curly", "be curly"]],
      ["rosemary_mint", ["rosemary-mint", "rosemary mint", "biberiyeli"]],
      ["shampure", ["shampure"]],
      ["color_renewal", ["color-renewal", "color renewal"]],
      ["scalp_solutions", ["scalp-solutions", "scalp solutions"]],
      ["smooth_infusion", ["smooth-infusion", "smooth infusion"]],
      ["speed_of_light", ["speed-of-light", "speed of light"]],
      ["hand_relief", ["hand-relief", "hand relief"]],
      ["foot_relief", ["foot-relief", "foot relief"]],
      ["damage_remedy", ["damage-remedy", "damage remedy"]],
      ["cherry_almond", ["cherry-almond", "cherry almond"]],
      ["men_pure_formance", ["pure-formance", "pure formance"]],
      ["botanical_kinetics", ["botanical-kinetics", "botanical kinetics"]],
      ["tulasara", ["tulasara", "tulasāra"]],
      ["chakra", ["chakra", "cakra"]],
    ])
  }

  private firstMatch(
    text: string,
    rules: Array<[string, string[]]>
  ): string | null {
    const match = rules.find(([, tokens]) =>
      tokens.some((token) => text.includes(this.normalize(token)))
    )
    return match?.[0] ?? null
  }

  private allMatches(
    text: string,
    rules: Array<[string, string[]]>
  ): string[] {
    const matches = rules
      .filter(([, tokens]) =>
        tokens.some((token) => text.includes(this.normalize(token)))
      )
      .map(([value]) => value)

    return [...new Set(matches)]
  }
}

export const flattenTaxonomy = (
  taxonomy: BrandTaxonomyDefinition
): Array<{
  node: CategoryNodeDefinition
  depth: number
  slugPath: string[]
  namePath: string[]
}> => {
  const rows: Array<{
    node: CategoryNodeDefinition
    depth: number
    slugPath: string[]
    namePath: string[]
  }> = []

  const visit = (
    node: CategoryNodeDefinition,
    depth: number,
    slugPath: string[],
    namePath: string[]
  ) => {
    rows.push({ node, depth, slugPath, namePath })
    node.children?.forEach((child) =>
      visit(child, depth + 1, [...slugPath, child.slug], [...namePath, child.name])
    )
  }

  visit(taxonomy.root, 0, [taxonomy.root.slug], [taxonomy.root.name])
  return rows
}
