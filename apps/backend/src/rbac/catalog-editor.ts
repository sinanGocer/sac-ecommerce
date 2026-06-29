import type {
  AuthContext,
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export const CATALOG_EDITOR_ROLE_ID = "role_catalog_editor"
export const CATALOG_EDITOR_ROLE_NAME = "catalog_editor"

const OWNER_ADMIN_ROLE_KEYS = new Set([
  "admin",
  "owner",
  "super_admin",
  "role_admin",
  "role_owner",
  "role_super_admin",
])

const CATALOG_EDITOR_ROLE_KEYS = new Set([
  CATALOG_EDITOR_ROLE_ID,
  CATALOG_EDITOR_ROLE_NAME,
  "catalog editor",
])

const CATALOG_EDITOR_ALLOWED_PREFIXES = [
  "/admin/products",
  "/admin/product-variants",
  "/admin/product-categories",
  "/admin/collections",
  "/admin/inventory-items",
]

const CATALOG_EDITOR_BLOCKED_PREFIXES = [
  "/admin/orders",
  "/admin/customers",
  "/admin/payments",
  "/admin/payment-collections",
  "/admin/users",
  "/admin/api-keys",
  "/admin/rbac",
  "/admin/stores",
  "/admin/regions",
  "/admin/sales-channels",
  "/admin/shipping",
  "/admin/shipping-options",
  "/admin/shipping-profiles",
  "/admin/shipping-option-types",
  "/admin/stock-locations",
  "/admin/fulfillment-providers",
  "/admin/fulfillment-sets",
  "/admin/payment-providers",
  "/admin/tax-providers",
  "/admin/customer-messaging",
]

const CATALOG_EDITOR_BLOCKED_SEGMENTS = [
  "/batch",
  "/export",
  "/import",
  "/imports",
]

type Logger = {
  warn?: (message: string) => void
  info?: (message: string) => void
}

export type CatalogEditorDecision =
  | { applies: false; reason: "non_catalog_editor" | "owner_admin" }
  | { applies: true; allow: true; reason: "catalog_allowed" }
  | { applies: true; allow: false; reason: string }

export function normalizeRoleKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim().toLowerCase()

  return trimmed.length ? trimmed : null
}

function roleValuesFromAuthContext(authContext?: AuthContext): string[] {
  const rawRoles = authContext?.app_metadata?.roles
  const roles = Array.isArray(rawRoles) ? rawRoles : rawRoles ? [rawRoles] : []

  return roles.flatMap((role) => {
    if (typeof role === "string") {
      return [role]
    }

    if (role && typeof role === "object") {
      const record = role as Record<string, unknown>
      return [record.id, record.name].filter(
        (value): value is string => typeof value === "string"
      )
    }

    return []
  })
}

async function roleValuesFromRoleIds(
  req: MedusaRequest,
  roleIds: string[]
): Promise<string[]> {
  if (!roleIds.length) {
    return []
  }

  try {
    const query = req.scope?.resolve(ContainerRegistrationKeys.QUERY) as
      | {
          graph: (input: {
            entity: string
            fields: string[]
            filters: { id: string[] }
          }) => Promise<{ data?: Array<{ id?: string; name?: string }> }>
        }
      | undefined

    if (!query?.graph) {
      return []
    }

    const { data } = await query.graph({
      entity: "rbac_role",
      fields: ["id", "name"],
      filters: { id: roleIds },
    })

    return (data ?? []).flatMap((role) => [role.id, role.name]).filter(
      (value): value is string => typeof value === "string"
    )
  } catch {
    return []
  }
}

async function roleValuesFromCurrentUser(req: MedusaRequest): Promise<string[]> {
  const authContext = (req as MedusaRequest & { auth_context?: AuthContext })
    .auth_context

  if (authContext?.actor_type !== "user" || !authContext.actor_id) {
    return []
  }

  try {
    const query = req.scope?.resolve(ContainerRegistrationKeys.QUERY) as
      | {
          graph: (input: {
            entity: string
            fields: string[]
            filters: { id: string }
          }) => Promise<{
            data?: Array<{
              rbac_roles?: Array<{ id?: string; name?: string }>
            }>
          }>
        }
      | undefined

    if (!query?.graph) {
      return []
    }

    const { data } = await query.graph({
      entity: "user",
      fields: ["rbac_roles.id", "rbac_roles.name"],
      filters: { id: authContext.actor_id },
    })

    return (data?.[0]?.rbac_roles ?? []).flatMap((role) => [
      role.id,
      role.name,
    ]).filter((value): value is string => typeof value === "string")
  } catch {
    return []
  }
}

export async function resolveRoleKeys(req: MedusaRequest): Promise<Set<string>> {
  const authContext = (req as MedusaRequest & { auth_context?: AuthContext })
    .auth_context
  const tokenRoleValues = roleValuesFromAuthContext(authContext)
  const currentUserRoleValues = await roleValuesFromCurrentUser(req)
  const roleValues = currentUserRoleValues.length > 0
    ? currentUserRoleValues
    : tokenRoleValues
  const roleIds = roleValues.filter((role) => role.startsWith("role_"))
  const dbRoleValues = await roleValuesFromRoleIds(req, roleIds)
  const keys = new Set<string>()

  for (const value of [...roleValues, ...dbRoleValues]) {
    const key = normalizeRoleKey(value)
    if (key) {
      keys.add(key)
    }
  }

  return keys
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

function isCatalogEditor(roleKeys: Set<string>): boolean {
  for (const key of roleKeys) {
    if (CATALOG_EDITOR_ROLE_KEYS.has(key)) {
      return true
    }
  }

  return false
}

function isOwnerOrAdmin(roleKeys: Set<string>): boolean {
  for (const key of roleKeys) {
    if (OWNER_ADMIN_ROLE_KEYS.has(key)) {
      return true
    }
  }

  return false
}

export function decideCatalogEditorAccess(input: {
  method: string
  path: string
  roleKeys: Set<string>
}): CatalogEditorDecision {
  if (isOwnerOrAdmin(input.roleKeys)) {
    return { applies: false, reason: "owner_admin" }
  }

  if (!isCatalogEditor(input.roleKeys)) {
    return { applies: false, reason: "non_catalog_editor" }
  }

  const method = input.method.toUpperCase()
  const path = input.path.split("?")[0] || "/"

  if (method === "DELETE") {
    return { applies: true, allow: false, reason: "destructive_delete_denied" }
  }

  if (CATALOG_EDITOR_BLOCKED_PREFIXES.some((prefix) => matchesPrefix(path, prefix))) {
    return { applies: true, allow: false, reason: "blocked_admin_resource" }
  }

  if (!CATALOG_EDITOR_ALLOWED_PREFIXES.some((prefix) => matchesPrefix(path, prefix))) {
    return { applies: true, allow: false, reason: "default_deny" }
  }

  if (
    CATALOG_EDITOR_BLOCKED_SEGMENTS.some((segment) => path.includes(segment))
  ) {
    return { applies: true, allow: false, reason: "bulk_or_import_export_denied" }
  }

  return { applies: true, allow: true, reason: "catalog_allowed" }
}

function auditCatalogEditorDecision(input: {
  req: MedusaRequest
  logger?: Logger
  decision: CatalogEditorDecision
}) {
  if (!input.decision.applies) {
    return
  }

  const authContext = (input.req as MedusaRequest & { auth_context?: AuthContext })
    .auth_context
  const outcome = input.decision.allow ? "allow" : "deny"
  const message = [
    "catalog_editor_rbac",
    `outcome=${outcome}`,
    `reason=${input.decision.reason}`,
    `actor_id=${authContext?.actor_id ?? "unknown"}`,
    `actor_type=${authContext?.actor_type ?? "unknown"}`,
    `method=${input.req.method}`,
    `path=${input.req.originalUrl ?? input.req.path}`,
    `request_id=${input.req.requestId ?? "unknown"}`,
  ].join(" ")

  if (input.decision.allow) {
    input.logger?.info?.(message)
  } else {
    input.logger?.warn?.(message)
  }
}

export async function catalogEditorRbacMiddleware(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const logger = req.scope?.resolve(ContainerRegistrationKeys.LOGGER) as
    | Logger
    | undefined
  const roleKeys = await resolveRoleKeys(req)
  const decision = decideCatalogEditorAccess({
    method: req.method,
    path: req.originalUrl ?? req.path,
    roleKeys,
  })

  auditCatalogEditorDecision({ req, logger, decision })

  if (decision.applies && !decision.allow) {
    res.status(403).json({
      code: "catalog_editor_forbidden",
      message: "Forbidden",
      reason: decision.reason,
    })
    return
  }

  next()
}

export const catalogEditorRoleDefinition = {
  id: CATALOG_EDITOR_ROLE_ID,
  name: CATALOG_EDITOR_ROLE_NAME,
  description:
    "Catalog editor: products, product categories, collections, and inventory without destructive delete or admin settings access.",
  policies: [
    { resource: "product", operation: ["read", "create", "update"] },
    { resource: "product_variant", operation: ["read", "create", "update"] },
    { resource: "product_option", operation: ["read", "create", "update"] },
    { resource: "product_category", operation: ["read", "create", "update"] },
    { resource: "product_collection", operation: ["read", "create", "update"] },
    { resource: "inventory_item", operation: ["read", "create", "update"] },
    { resource: "inventory_level", operation: ["read", "create", "update"] },
  ],
} as const
