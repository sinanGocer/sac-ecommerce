export interface CategoryNodeDefinition {
  name: string
  slug: string
  children?: CategoryNodeDefinition[]
}

export interface BrandTaxonomyDefinition {
  brand: string
  slug: string
  root: CategoryNodeDefinition
}

const node = (
  name: string,
  slug: string,
  children?: CategoryNodeDefinition[]
): CategoryNodeDefinition => ({ name, slug, children })

export const AVEDA_TAXONOMY: BrandTaxonomyDefinition = {
  brand: "Aveda",
  slug: "aveda",
  root: node("Aveda", "aveda", [
    node("Saç Bakımı", "sac-bakimi", [
      node("Şampuan", "sampuan"),
      node("Saç Kremi", "sac-kremi"),
      node("Maske", "maske"),
      node("Serum ve Yağlar", "serum-ve-yaglar"),
      node("Leave-in Bakım", "leave-in-bakim"),
      node("Blonde Care", "blonde-care"),
      node("Color Care", "color-care"),
      node("Curly Hair", "curly-hair"),
      node("Volume", "volume"),
      node("Scalp Care", "scalp-care"),
    ]),
    node("Şekillendirme", "sekillendirme", [
      node("Isı Koruyucular", "isi-koruyucular"),
      node("Spreyler", "spreyler"),
      node("Köpükler", "kopukler"),
      node("Kremler", "kremler"),
      node("Wax", "wax"),
    ]),
    node("Vücut Bakımı", "vucut-bakimi", [
      node("El Bakımı", "el-bakimi"),
      node("Ayak Bakımı", "ayak-bakimi"),
      node("Duş Ürünleri", "dus-urunleri"),
    ]),
  ]),
}

export const BRAND_TAXONOMIES: Record<string, BrandTaxonomyDefinition> = {
  aveda: AVEDA_TAXONOMY,
}

export const categoryExternalId = (slugPath: string[]): string =>
  `product-sync:category:${slugPath.join("/")}`

export const categoryHandle = (slugPath: string[]): string =>
  slugPath.join("-")

