export type ProductCatalogBrandStatus = "active" | "planned"

export type ProductCatalogBrandDefinition = {
  name: string
  slug: string
  status: ProductCatalogBrandStatus
}

export type ProductCatalogCategoryNode = {
  name: string
  slug: string
  children?: ProductCatalogCategoryNode[]
}

export type ProductCatalogTree = {
  brand: ProductCatalogBrandDefinition
  categories: ProductCatalogCategoryNode[]
}

const category = (
  name: string,
  slug: string,
  children?: ProductCatalogCategoryNode[]
): ProductCatalogCategoryNode => ({
  name,
  slug,
  children,
})

export const PRODUCT_CATALOG_BRANDS: ProductCatalogBrandDefinition[] = [
  {
    name: "Aveda",
    slug: "aveda",
    status: "active",
  },
  {
    name: "Kerastase",
    slug: "kerastase",
    status: "planned",
  },
  {
    name: "Olaplex",
    slug: "olaplex",
    status: "planned",
  },
  {
    name: "Davines",
    slug: "davines",
    status: "planned",
  },
  {
    name: "Kevin Murphy",
    slug: "kevin-murphy",
    status: "planned",
  },
  {
    name: "L'Oréal Professionnel",
    slug: "loreal-professionnel",
    status: "planned",
  },
]

export const AVEDA_PRODUCT_CATALOG_TREE: ProductCatalogTree = {
  brand: PRODUCT_CATALOG_BRANDS[0],
  categories: [
    category("Şampuan", "sampuan", [
      category("Color Care", "color-care"),
      category("Blonde Care", "blonde-care"),
      category("Curly Hair", "curly-hair"),
      category("Scalp Care", "scalp-care"),
      category("Volume", "volume"),
      category("Nutriplenish", "nutriplenish"),
      category("Damage Repair", "damage-repair"),
      category("Smooth / Anti-Frizz", "smooth-anti-frizz"),
    ]),
    category("Saç Kremi", "sac-kremi", [
      category("Color Care", "color-care"),
      category("Blonde Care", "blonde-care"),
      category("Curly Hair", "curly-hair"),
      category("Scalp Care", "scalp-care"),
      category("Volume", "volume"),
      category("Nutriplenish", "nutriplenish"),
      category("Damage Repair", "damage-repair"),
      category("Smooth / Anti-Frizz", "smooth-anti-frizz"),
    ]),
    category("Maske", "maske", [
      category("Color Care", "color-care"),
      category("Curly Hair", "curly-hair"),
      category("Nutriplenish", "nutriplenish"),
      category("Damage Repair", "damage-repair"),
      category("Scalp Care", "scalp-care"),
    ]),
    category("Leave-In", "leave-in", [
      category("Nemlendirme", "nemlendirme"),
      category("Onarım", "onarim"),
      category("Isı Koruma", "isi-koruma"),
      category("Bukle Belirginleştirme", "bukle-belirginlestirme"),
      category("Smooth / Anti-Frizz", "smooth-anti-frizz"),
    ]),
    category("Serum ve Yağlar", "serum-ve-yaglar", [
      category("Saç Serumu", "sac-serumu"),
      category("Saç Yağı", "sac-yagi"),
      category("Scalp Serum", "scalp-serum"),
      category("Nutriplenish", "nutriplenish"),
      category("Invati Advanced", "invati-advanced"),
    ]),
    category("Şekillendirici", "sekillendirici", [
      category("Sprey", "sprey"),
      category("Köpük", "kopuk"),
      category("Krem", "krem"),
      category("Wax", "wax"),
      category("Jel", "jel"),
      category("Tonik", "tonik"),
      category("Isı Koruyucu", "isi-koruyucu"),
      category("Erkek Şekillendirici", "erkek-sekillendirici"),
    ]),
    category("Vücut Bakımı", "vucut-bakimi", [
      category("El Bakımı", "el-bakimi"),
      category("Ayak Bakımı", "ayak-bakimi"),
      category("Duş Ürünleri", "dus-urunleri"),
      category("Vücut Kremi", "vucut-kremi"),
    ]),
    category("Cilt Bakımı", "cilt-bakimi", [
      category("Temizleyici", "temizleyici"),
      category("Serum", "serum"),
      category("Nemlendirici", "nemlendirici"),
      category("Tonik / Mist", "tonik-mist"),
      category("Maske", "maske"),
      category("Göz Bakımı", "goz-bakimi"),
      category("Tıraş", "tiras"),
    ]),
    category("Aroma / Pure-Fume", "aroma-pure-fume", [
      category("Chakra Mist", "chakra-mist"),
      category("Aromatik Yağ", "aromatik-yag"),
    ]),
    category("Aksesuarlar", "aksesuarlar", [
      category("Saç Fırçaları", "sac-fircalari"),
      category("Scalp Brush", "scalp-brush"),
    ]),
  ],
}

export const PRODUCT_CATALOG_TREES: Record<string, ProductCatalogTree> = {
  aveda: AVEDA_PRODUCT_CATALOG_TREE,
}

export type FlattenedProductCatalogCategory = {
  node: ProductCatalogCategoryNode
  depth: number
  slugPath: string[]
  namePath: string[]
  brand: ProductCatalogBrandDefinition
}

export const productCatalogCategoryExternalId = (slugPath: string[]): string =>
  `product-catalog:category:${slugPath.join("/")}`

export const productCatalogCategoryHandle = (slugPath: string[]): string =>
  slugPath.join("-")

export const flattenProductCatalogTree = (
  tree: ProductCatalogTree
): FlattenedProductCatalogCategory[] => {
  const rows: FlattenedProductCatalogCategory[] = [
    {
      node: {
        name: tree.brand.name,
        slug: tree.brand.slug,
        children: tree.categories,
      },
      depth: 0,
      slugPath: [tree.brand.slug],
      namePath: [tree.brand.name],
      brand: tree.brand,
    },
  ]

  const visit = (
    node: ProductCatalogCategoryNode,
    depth: number,
    slugPath: string[],
    namePath: string[]
  ) => {
    rows.push({
      node,
      depth,
      slugPath,
      namePath,
      brand: tree.brand,
    })

    node.children?.forEach((child) =>
      visit(child, depth + 1, [...slugPath, child.slug], [...namePath, child.name])
    )
  }

  tree.categories.forEach((child) =>
    visit(child, 1, [tree.brand.slug, child.slug], [tree.brand.name, child.name])
  )

  return rows
}
