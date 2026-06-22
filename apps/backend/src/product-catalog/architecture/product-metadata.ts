export type ProductCatalogMetadata = {
  brand: string
  category: string
  subcategory: string | null
  hair_type: string[]
  concerns: string[]
  benefits: string[]
  size_ml: number | null
  vegan: boolean | null
  color_safe: boolean | null
  ingredients: string | null
  usage: string | null
  description: string | null
  is_gift_set: boolean
  size_type: "travel" | "full_size" | null
  limited_edition: boolean
}

export const PRODUCT_CATALOG_METADATA_FIELDS: Array<keyof ProductCatalogMetadata> =
  [
    "brand",
    "category",
    "subcategory",
    "hair_type",
    "concerns",
    "benefits",
    "size_ml",
    "vegan",
    "color_safe",
    "ingredients",
    "usage",
    "description",
    "is_gift_set",
    "size_type",
    "limited_edition",
  ]

export const PRODUCT_CATALOG_METADATA_DEFAULTS: ProductCatalogMetadata = {
  brand: "",
  category: "",
  subcategory: null,
  hair_type: [],
  concerns: [],
  benefits: [],
  size_ml: null,
  vegan: null,
  color_safe: null,
  ingredients: null,
  usage: null,
  description: null,
  is_gift_set: false,
  size_type: null,
  limited_edition: false,
}
