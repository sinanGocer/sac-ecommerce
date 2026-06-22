import {
  ProductCatalogCategoryNode,
  ProductCatalogTree,
} from "./brand-catalog"

export const renderProductCatalogTree = (tree: ProductCatalogTree): string[] => {
  const lines = [tree.brand.name.toUpperCase()]

  tree.categories.forEach((node, index) => {
    renderNode(lines, node, "", index === tree.categories.length - 1)
  })

  return lines
}

const renderNode = (
  lines: string[],
  node: ProductCatalogCategoryNode,
  prefix: string,
  isLast: boolean
) => {
  lines.push(`${prefix}${isLast ? "└─" : "├─"} ${node.name}`)

  const nextPrefix = `${prefix}${isLast ? "   " : "│  "}`
  node.children?.forEach((child, index) => {
    renderNode(lines, child, nextPrefix, index === node.children!.length - 1)
  })
}
