import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createProductCategoriesWorkflow,
  updateProductCategoriesWorkflow,
} from "@medusajs/medusa/core-flows"

import {
  flattenProductCatalogTree,
  productCatalogCategoryExternalId,
  productCatalogCategoryHandle,
  ProductCatalogTree,
} from "../architecture"
import { SyncLogger } from "../../product-sync/types/product-sync.types"

type ExistingCategory = {
  id: string
  name: string
  handle: string
  parent_category_id: string | null
  external_id: string | null
  metadata: Record<string, unknown> | null
}

export type ProductCatalogBootstrapResult = {
  idByExternalId: Map<string, string>
  created: Array<{
    id: string
    name: string
    handle: string
    external_id: string
    path: string
  }>
  existing: Array<{
    id: string
    name: string
    handle: string
    external_id: string
    path: string
  }>
  updated: Array<{
    id: string
    name: string
    handle: string
    previous_external_id: string | null
    external_id: string
    path: string
  }>
  totalManaged: number
}

export class ProductCatalogCategoryService {
  constructor(
    private readonly container: ExecArgs["container"],
    private readonly logger: SyncLogger
  ) {}

  async ensureTree(tree: ProductCatalogTree): Promise<ProductCatalogBootstrapResult> {
    const idByExternalId = new Map<string, string>()
    const idByHandleAndParent = new Map<string, string>()
    const existingById = new Map<string, ExistingCategory>()
    const created: ProductCatalogBootstrapResult["created"] = []
    const existingRows: ProductCatalogBootstrapResult["existing"] = []
    const updated: ProductCatalogBootstrapResult["updated"] = []
    const flatRows = flattenProductCatalogTree(tree)

    const seedExisting = async () => {
      const existing = await this.listExisting()
      idByExternalId.clear()
      idByHandleAndParent.clear()
      existingById.clear()

      for (const category of existing) {
        existingById.set(category.id, category)
        if (category.external_id) {
          idByExternalId.set(category.external_id, category.id)
        }
        idByHandleAndParent.set(
          this.handleParentKey(category.handle, category.parent_category_id),
          category.id
        )
      }
    }

    await seedExisting()

    for (const row of flatRows) {
      const externalId = productCatalogCategoryExternalId(row.slugPath)
      const handle = productCatalogCategoryHandle(row.slugPath)
      const parentExternalId =
        row.slugPath.length > 1
          ? productCatalogCategoryExternalId(row.slugPath.slice(0, -1))
          : null
      const parentId = parentExternalId
        ? idByExternalId.get(parentExternalId) ?? null
        : null

      const existingId =
        idByExternalId.get(externalId) ??
        idByHandleAndParent.get(this.handleParentKey(handle, parentId))

      if (existingId) {
        const existing = existingById.get(existingId)
        if (existing?.external_id !== externalId) {
          await updateProductCategoriesWorkflow(this.container).run({
            input: {
              selector: { id: existingId },
              update: {
                external_id: externalId,
                metadata: {
                  ...(existing?.metadata ?? {}),
                  catalog_kind:
                    row.depth === 0
                      ? "brand"
                      : row.depth === 1
                        ? "category"
                        : "subcategory",
                  brand: row.brand.name,
                  brand_slug: row.brand.slug,
                  category_slug: row.slugPath[1] ?? null,
                  subcategory_slug: row.slugPath[2] ?? null,
                  managed_by: "product-catalog-architecture",
                  source: row.brand.slug === "aveda" ? "aveda.com" : "manual",
                },
              },
            },
          })
          updated.push({
            id: existingId,
            name: row.node.name,
            handle,
            previous_external_id: existing?.external_id ?? null,
            external_id: externalId,
            path: row.namePath.join(" > "),
          })
        }
        idByExternalId.set(externalId, existingId)
        existingRows.push({
          id: existingId,
          name: row.node.name,
          handle,
          external_id: externalId,
          path: row.namePath.join(" > "),
        })
        continue
      }

      const { result } = await createProductCategoriesWorkflow(
        this.container
      ).run({
        input: {
          product_categories: [
            {
              name: row.node.name,
              handle,
              parent_category_id: parentId,
              rank: row.depth,
              is_active: true,
              is_internal: false,
              external_id: externalId,
              metadata: {
                catalog_kind:
                  row.depth === 0
                    ? "brand"
                    : row.depth === 1
                      ? "category"
                      : "subcategory",
                brand: row.brand.name,
                brand_slug: row.brand.slug,
                category_slug: row.slugPath[1] ?? null,
                subcategory_slug: row.slugPath[2] ?? null,
                managed_by: "product-catalog-architecture",
                source: row.brand.slug === "aveda" ? "aveda.com" : "manual",
              },
            },
          ],
        },
      })

      const category = result[0]
      idByExternalId.set(externalId, category.id)
      existingById.set(category.id, {
        id: category.id,
        name: row.node.name,
        handle,
        parent_category_id: parentId,
        external_id: externalId,
        metadata: category.metadata as Record<string, unknown> | null,
      })
      idByHandleAndParent.set(this.handleParentKey(handle, parentId), category.id)
      created.push({
        id: category.id,
        name: row.node.name,
        handle,
        external_id: externalId,
        path: row.namePath.join(" > "),
      })
      this.logger.info(`[catalog] kategori oluşturuldu: ${row.namePath.join(" > ")}`)
    }

    return {
      idByExternalId,
      created,
      updated,
      existing: existingRows,
      totalManaged: flatRows.length,
    }
  }

  renderTree(tree: ProductCatalogTree): string[] {
    const lines = [tree.brand.name.toUpperCase()]

    const visit = (
      children: ProductCatalogTree["categories"],
      prefix: string
    ) => {
      children.forEach((child, index) => {
        const isLast = index === children.length - 1
        lines.push(`${prefix}${isLast ? "└── " : "├── "}${child.name}`)
        if (child.children?.length) {
          visit(child.children, `${prefix}${isLast ? "    " : "│   "}`)
        }
      })
    }

    visit(tree.categories, "")
    return lines
  }

  private async listExisting(): Promise<ExistingCategory[]> {
    const query = this.container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "product_category",
      fields: [
        "id",
        "name",
        "handle",
        "parent_category_id",
        "external_id",
        "metadata",
      ],
    })

    return data.map((category) => ({
      id: category.id,
      name: category.name,
      handle: category.handle,
      parent_category_id: category.parent_category_id ?? null,
      external_id: category.external_id ?? null,
      metadata: (category.metadata ?? null) as Record<string, unknown> | null,
    }))
  }

  private handleParentKey(handle: string, parentId: string | null): string {
    return `${parentId ?? "root"}:${handle}`
  }
}
