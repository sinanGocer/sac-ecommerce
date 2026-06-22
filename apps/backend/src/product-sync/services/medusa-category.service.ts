import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createProductCategoriesWorkflow } from "@medusajs/medusa/core-flows"

import {
  BrandTaxonomyDefinition,
  categoryExternalId,
  categoryHandle,
} from "../taxonomies/brand-taxonomy"
import { ProductCategoryPath, SyncLogger } from "../types/product-sync.types"
import { flattenTaxonomy } from "./category-mapping.service"

interface ExistingCategory {
  id: string
  name: string
  handle: string
  parent_category_id: string | null
  external_id: string | null
}

export class MedusaCategoryService {
  constructor(
    private readonly container: ExecArgs["container"],
    private readonly logger: SyncLogger
  ) {}

  async ensureTaxonomy(
    taxonomy: BrandTaxonomyDefinition
  ): Promise<Map<string, string>> {
    const idByExternalId = new Map<string, string>()
    const idByHandleAndParent = new Map<string, string>()

    const seedExisting = async () => {
      const existing = await this.listExisting()
      idByExternalId.clear()
      idByHandleAndParent.clear()

      for (const category of existing) {
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

    for (const row of flattenTaxonomy(taxonomy)) {
      const externalId = categoryExternalId(row.slugPath)
      const handle = categoryHandle(row.slugPath)
      const parentExternalId =
        row.slugPath.length > 1
          ? categoryExternalId(row.slugPath.slice(0, -1))
          : null
      const parentId = parentExternalId
        ? idByExternalId.get(parentExternalId) ?? null
        : null

      const existingId =
        idByExternalId.get(externalId) ??
        idByHandleAndParent.get(this.handleParentKey(handle, parentId))

      if (existingId) {
        idByExternalId.set(externalId, existingId)
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
                sync_managed: true,
                brand: taxonomy.brand,
                category_path: row.namePath.join(" > "),
              },
            },
          ],
        },
      })

      const created = result[0]
      idByExternalId.set(externalId, created.id)
      idByHandleAndParent.set(this.handleParentKey(handle, parentId), created.id)
      this.logger.info(
        `[category] oluşturuldu: ${row.namePath.join(" > ")} (${created.id})`
      )
    }

    return idByExternalId
  }

  async ensureProductCategory(
    categoryPath: ProductCategoryPath
  ): Promise<string | null> {
    const externalId = categoryPath.externalId
    const existing = await this.listExisting()
    const found = existing.find((category) => category.external_id === externalId)
    return found?.id ?? null
  }

  renderTaxonomy(taxonomy: BrandTaxonomyDefinition): string[] {
    const lines: string[] = [taxonomy.root.name]

    const visit = (
      children: NonNullable<BrandTaxonomyDefinition["root"]["children"]>,
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

    visit(taxonomy.root.children ?? [], "")
    return lines
  }

  private async listExisting(): Promise<ExistingCategory[]> {
    const query = this.container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "product_category",
      fields: ["id", "name", "handle", "parent_category_id", "external_id"],
    })

    return data.map((category) => ({
      id: category.id,
      name: category.name,
      handle: category.handle,
      parent_category_id: category.parent_category_id ?? null,
      external_id: category.external_id ?? null,
    }))
  }

  private handleParentKey(handle: string, parentId: string | null): string {
    return `${parentId ?? "root"}:${handle}`
  }
}
