import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  assignUserRolesWorkflow,
  createRbacPoliciesWorkflow,
  createRbacRolePoliciesWorkflow,
  createRbacRolesWorkflow,
} from "@medusajs/medusa/core-flows"

import {
  CATALOG_EDITOR_ROLE_ID,
  catalogEditorRoleDefinition,
} from "../rbac/catalog-editor"

type QueryGraph = {
  graph: (input: unknown) => Promise<{ data?: unknown[] }>
}

type RoleRow = { id: string; name?: string | null }
type PolicyRow = { id: string; resource?: string | null; operation?: string | null }

function asArray<T>(value: T | readonly T[]): T[] {
  return Array.isArray(value) ? [...(value as T[])] : [value as T]
}

export default async function catalogEditorRbacSetup({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const commit = process.env.CATALOG_EDITOR_RBAC_COMMIT === "true"
  const userId = process.env.CATALOG_EDITOR_USER_ID?.trim() || null
  const actorId = process.env.CATALOG_EDITOR_ACTOR_ID?.trim() || "system"

  const { data: roles } = await query.graph({
    entity: "rbac_role",
    fields: ["id", "name"],
    filters: {},
  })
  let role =
    ((roles ?? []) as RoleRow[]).find(
      (row) =>
        row.id === CATALOG_EDITOR_ROLE_ID ||
        row.name === catalogEditorRoleDefinition.name
    ) ?? null

  if (!role && commit) {
    const { result } = await createRbacRolesWorkflow(container).run({
      input: {
        actor_id: actorId,
        actor: "user",
        roles: [{
          name: catalogEditorRoleDefinition.name,
          description: catalogEditorRoleDefinition.description,
          metadata: {
            managed_by: "catalog-editor-rbac-setup",
          },
        }],
      },
    })
    role = result[0] as RoleRow
  }

  const desiredPolicies = catalogEditorRoleDefinition.policies.flatMap((policy) =>
    asArray(policy.operation).map((operation) => ({
      resource: policy.resource,
      operation,
    }))
  )

  const { data: existingPoliciesData } = await query.graph({
    entity: "rbac_policy",
    fields: ["id", "resource", "operation"],
    filters: {},
  })
  const existingPolicies = (existingPoliciesData ?? []) as PolicyRow[]
  const existingByKey = new Map(
    existingPolicies.map((policy) => [
      `${policy.resource}:${policy.operation}`,
      policy,
    ])
  )
  const missingPolicies = desiredPolicies.filter(
    (policy) => !existingByKey.has(`${policy.resource}:${policy.operation}`)
  )

  let createdPolicyIds: string[] = []
  if (missingPolicies.length > 0 && commit) {
    const { result } = await createRbacPoliciesWorkflow(container).run({
      input: {
        policies: missingPolicies.map((policy) => ({
          ...policy,
          metadata: { managed_by: "catalog-editor-rbac-setup" },
        })),
      },
    })
    createdPolicyIds = (result as PolicyRow[]).map((policy) => policy.id)
  }

  const allPolicyIds = [
    ...desiredPolicies
      .map((policy) => existingByKey.get(`${policy.resource}:${policy.operation}`)?.id)
      .filter((id): id is string => typeof id === "string"),
    ...createdPolicyIds,
  ]

  let linkedPolicyIds = new Set<string>()
  if (role) {
    const { data: rolePoliciesData } = await query.graph({
      entity: "rbac_role_policy",
      fields: ["policy_id"],
      filters: { role_id: role.id },
    })
    linkedPolicyIds = new Set(
      (rolePoliciesData ?? [])
        .map((link) => (link as { policy_id?: string }).policy_id)
        .filter((id): id is string => typeof id === "string")
    )
  }

  const missingRolePolicyIds = allPolicyIds.filter(
    (policyId) => !linkedPolicyIds.has(policyId)
  )

  if (role && missingRolePolicyIds.length > 0 && commit) {
    await createRbacRolePoliciesWorkflow(container).run({
      input: {
        actor_id: actorId,
        actor: "user",
        policies: missingRolePolicyIds.map((policyId) => ({
          role_id: role!.id,
          policy_id: policyId,
        })),
      },
    })
  }

  let assigned = false
  if (role && userId && commit) {
    await assignUserRolesWorkflow(container).run({
      input: {
        actor_id: actorId,
        actor: "user",
        user_id: userId,
        role_ids: [role.id],
      },
    })
    assigned = true
  }

  logger.info("──────── CATALOG EDITOR RBAC SETUP ────────")
  logger.info(`mode=${commit ? "commit" : "dry-run"} role=${role?.id ?? CATALOG_EDITOR_ROLE_ID}`)
  logger.info(`role_exists=${Boolean(roles?.[0])} missing_policies=${missingPolicies.length} missing_role_policy_links=${missingRolePolicyIds.length}`)
  logger.info(`target_user=${userId ?? "-"} assigned=${assigned}`)
  if (!commit) {
    logger.info("Commit için: CATALOG_EDITOR_RBAC_COMMIT=true CATALOG_EDITOR_USER_ID=<existing_user_id> npm run catalog:editor-rbac:setup")
  }
}
