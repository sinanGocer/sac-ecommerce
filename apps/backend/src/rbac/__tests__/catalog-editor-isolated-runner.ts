import {
  CATALOG_EDITOR_ROLE_ID,
  CatalogEditorDecision,
  catalogEditorRoleDefinition,
  decideCatalogEditorAccess,
  normalizeRoleKey,
} from "../catalog-editor"

function ok(condition: boolean, label: string) {
  if (!condition) {
    throw new Error(`FAIL ${label}`)
  }
  console.log(`ok ${label}`)
}

function roles(...values: string[]) {
  return new Set(values.map((value) => normalizeRoleKey(value)).filter(Boolean) as string[])
}

function allow(method: string, path: string, roleKeys = roles(CATALOG_EDITOR_ROLE_ID)) {
  return decideCatalogEditorAccess({ method, path, roleKeys })
}

function allowed(decision: CatalogEditorDecision): boolean {
  return decision.applies === true && decision.allow === true
}

function denied(decision: CatalogEditorDecision): boolean {
  return decision.applies === true && decision.allow === false
}

function run() {
  ok(catalogEditorRoleDefinition.id === CATALOG_EDITOR_ROLE_ID, "role id is stable")
  ok(catalogEditorRoleDefinition.name === "catalog_editor", "role name is catalog_editor")
  ok(!catalogEditorRoleDefinition.policies.some((p) => (p.operation as readonly string[]).includes("delete")), "role definition has no delete policy")

  ok(allowed(allow("GET", "/admin/products")), "products read allowed")
  ok(allowed(allow("POST", "/admin/products")), "products create allowed")
  ok(allowed(allow("POST", "/admin/products/prod_1")), "products update allowed")
  ok(allowed(allow("GET", "/admin/product-variants")), "product variants allowed")
  ok(allowed(allow("GET", "/admin/product-categories")), "categories allowed")
  ok(allowed(allow("POST", "/admin/product-categories/pcat_1")), "category update allowed")
  ok(allowed(allow("GET", "/admin/collections")), "collections allowed")
  ok(allowed(allow("POST", "/admin/collections/col_1/products")), "collection product linking allowed")
  ok(allowed(allow("GET", "/admin/inventory-items")), "inventory items allowed")
  ok(allowed(allow("POST", "/admin/inventory-items/ii_1/location-levels")), "inventory levels allowed")

  ok(denied(allow("DELETE", "/admin/products/prod_1")), "product delete denied")
  ok(denied(allow("DELETE", "/admin/product-categories/pcat_1")), "category delete denied")
  ok(denied(allow("DELETE", "/admin/collections/col_1")), "collection delete denied")
  ok(denied(allow("DELETE", "/admin/inventory-items/ii_1/location-levels/sloc_1")), "inventory level delete denied")
  ok(denied(allow("POST", "/admin/products/batch")), "product batch denied")
  ok(denied(allow("POST", "/admin/products/import")), "product import denied")
  ok(denied(allow("POST", "/admin/products/export")), "product export denied")

  ok(denied(allow("GET", "/admin/orders")), "orders denied")
  ok(denied(allow("GET", "/admin/customers")), "customers denied")
  ok(denied(allow("GET", "/admin/payments")), "payments denied")
  ok(denied(allow("GET", "/admin/users")), "users denied")
  ok(denied(allow("GET", "/admin/api-keys")), "api keys denied")
  ok(denied(allow("GET", "/admin/stores")), "settings denied")
  ok(denied(allow("GET", "/admin/regions")), "regions denied")
  ok(denied(allow("GET", "/admin/shipping-options")), "shipping denied")
  ok(denied(allow("GET", "/admin/customer-messaging/templates")), "custom admin mutation area denied")
  ok(denied(allow("GET", "/admin/workflows-executions")), "unknown admin area default denied")

  const owner = allow("DELETE", "/admin/products/prod_1", roles("role_super_admin", CATALOG_EDITOR_ROLE_ID))
  ok(owner.applies === false && owner.reason === "owner_admin", "owner admin bypass keeps full access")

  const nonCatalog = allow("GET", "/admin/orders", roles("role_sales"))
  ok(nonCatalog.applies === false && nonCatalog.reason === "non_catalog_editor", "other roles defer to Medusa RBAC")
}

run()
