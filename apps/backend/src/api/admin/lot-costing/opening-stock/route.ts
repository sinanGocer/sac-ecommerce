import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { LOT_COSTING_MODULE } from "../../../../modules/lot-costing"
import type LotCostingService from "../../../../modules/lot-costing/service"
import { viewerRoleFromKeys } from "../../../../inventory-costing/redaction"
import { resolveRoleKeys } from "../../../../rbac/catalog-editor"

/**
 * GET /admin/lot-costing/opening-stock — READ-ONLY (owner/admin).
 *
 * Maliyet lotu OLMAYAN varyantları (UNVALUED_OPENING_STOCK) listeler. Owner'ın
 * maliyet girmesi gereken kayıtlar. Otomatik maliyet/lot OLUŞTURMAZ; mevcut
 * stok/fiyatı DEĞİŞTİRMEZ. catalog_editor için 403.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const roleKeys = await resolveRoleKeys(req).catch(() => new Set<string>())
  if (viewerRoleFromKeys(roleKeys) !== "owner") {
    res.status(403).json({ message: "forbidden: owner/admin only" })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const lotService = req.scope.resolve<LotCostingService>(LOT_COSTING_MODULE)

  // Maliyet lotu olan variant_id'ler.
  const lotRows = (await lotService
    .listInventoryCostLots({} as never, { take: 100000, select: ["variant_id"] } as never)
    .catch(() => [])) as Array<{ variant_id?: string }>
  const valuedVariants = new Set(lotRows.map((l) => l.variant_id).filter((x): x is string => !!x))

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "status", "variants.id", "variants.title", "variants.inventory_quantity"],
  })

  const unvalued: Array<{ product_id: string; title: string | null; variant_id: string; variant_title: string | null; current_stock: number; status: string }> = []
  for (const p of (products ?? []) as any[]) {
    if (p.status !== "published") continue
    for (const v of p.variants ?? []) {
      if (!v.id || valuedVariants.has(v.id)) continue
      unvalued.push({
        product_id: p.id,
        title: p.title ?? null,
        variant_id: v.id,
        variant_title: v.title ?? null,
        current_stock: Number(v.inventory_quantity ?? 0),
        status: "UNVALUED_OPENING_STOCK",
      })
    }
  }

  res.json({
    unvalued_count: unvalued.length,
    note: "Bu varyantlar için owner maliyet girmeli; aksi halde gerçek kâr/fiyat uygulaması bloke.",
    items: unvalued,
  })
}
