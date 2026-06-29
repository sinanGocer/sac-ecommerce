/**
 * Test fixture factory — YALNIZ izole test DB içinde kullanılır. Gerçek katalog
 * verisi (74 ürün) KOPYALANMAZ; tüm id'ler sentetik ("test_*") prefixlidir.
 */

export interface SeedLotInput {
  id?: string
  variant_id?: string
  product_id?: string
  received_quantity: number
  remaining_quantity?: number
  unit_cost: number
  received_at: string
  status?: string
  idempotency_key?: string
}

let seq = 0
function nextKey(prefix: string): string {
  seq += 1
  return `${prefix}_${seq}_${Math.random().toString(36).slice(2, 8)}`
}

export const TEST_VARIANT = "test_variant_v1"
export const TEST_PRODUCT = "test_product_p1"

export async function seedLot(manager: any, Lot: unknown, input: SeedLotInput): Promise<string> {
  const id = input.id ?? nextKey("test_lot")
  const em = manager.fork()
  em.create(Lot, {
    id,
    product_id: input.product_id ?? TEST_PRODUCT,
    variant_id: input.variant_id ?? TEST_VARIANT,
    received_quantity: input.received_quantity,
    remaining_quantity: input.remaining_quantity ?? input.received_quantity,
    reserved_quantity: 0,
    unit_purchase_cost: input.unit_cost,
    purchase_vat_rate: 0,
    allocated_shipping_cost: 0,
    allocated_additional_cost: 0,
    effective_unit_cost: input.unit_cost,
    received_at: new Date(input.received_at),
    status: input.status ?? "active",
    idempotency_key: input.idempotency_key ?? nextKey("test_lotkey"),
  })
  await em.flush()
  return id
}

/** Zorunlu senaryo: Lot A 20×100 TL, Lot B 100×140 TL (A daha eski → önce tüketilir). */
export async function seedScenarioAB(
  manager: any,
  Lot: unknown,
  variantId = TEST_VARIANT
): Promise<{ lotA: string; lotB: string }> {
  const lotA = await seedLot(manager, Lot, {
    id: `test_lot_A_${nextKey("ab")}`,
    variant_id: variantId,
    received_quantity: 20,
    unit_cost: 100,
    received_at: "2026-01-01T00:00:00.000Z",
  })
  const lotB = await seedLot(manager, Lot, {
    id: `test_lot_B_${nextKey("ab")}`,
    variant_id: variantId,
    received_quantity: 100,
    unit_cost: 140,
    received_at: "2026-02-01T00:00:00.000Z",
  })
  return { lotA, lotB }
}

export async function readLots(manager: any, Lot: unknown, variantId = TEST_VARIANT): Promise<Array<Record<string, any>>> {
  const em = manager.fork()
  return em.find(Lot, { variant_id: variantId }, { orderBy: { received_at: "ASC", id: "ASC" } })
}

export async function readAllocations(
  manager: any,
  Allocation: unknown,
  orderId: string
): Promise<Array<Record<string, any>>> {
  const em = manager.fork()
  return em.find(Allocation, { order_id: orderId }, { orderBy: { id: "ASC" } })
}

export async function totalRemaining(manager: any, Lot: unknown, variantId = TEST_VARIANT): Promise<number> {
  const lots = await readLots(manager, Lot, variantId)
  return lots.reduce((s, l) => s + Number(l.remaining_quantity), 0)
}

/** RBAC bağlamları — viewerRoleFromKeys ile aynı anahtar formatı. */
export const OWNER_ROLE_KEYS = ["owner"]
export const CATALOG_EDITOR_ROLE_KEYS = ["catalog_editor"]
