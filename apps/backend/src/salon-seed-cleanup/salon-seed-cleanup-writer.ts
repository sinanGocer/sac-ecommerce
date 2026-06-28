import { SalonSeedCleanupDecision } from "./salon-seed-cleanup-policy"
import { SalonSeedCleanupPlan } from "./salon-seed-cleanup-service"

/**
 * Salon Seed Cleanup — commit writer (mutation executor).
 *
 * SAF/test edilebilir: gerçek Medusa workflow/servis çağrıları `SeedCleanupMutator`
 * arayüzü üzerinden enjekte edilir. Writer YALNIZ planın `planned` aksiyonlarını
 * uygular; `no_op` atlanır, `blocked` hiç bulunmaz (READY planda blocked yoktur).
 *
 * Hiçbir koşulda: hard delete üretmez, order/cart kayıtlarına dokunmaz, allowlist
 * dışı ürüne yazmaz. Bunların hepsi plan + writer aksiyon tipleriyle sınırlıdır:
 *   PRODUCT_UNPUBLISH         → status published→draft
 *   SALES_CHANNEL_DETACH      → ürünü kanal(lar)dan çıkar
 *   PROJECTION_REMOVE_OR_HIDE → search projection satırını sil
 */

export interface SeedCleanupMutator {
  /** Ürünü draft yapar (unpublish). */
  unpublishProduct(productId: string): Promise<void>
  /** Ürünü verilen sales channel'lardan çıkarır. */
  detachSalesChannels(productId: string, channelIds: string[]): Promise<void>
  /** Verilen projection satırını siler. */
  removeProjection(projectionId: string): Promise<void>
}

export interface ExecutedSeedAction {
  product_id: string
  handle: string | null
  action: "PRODUCT_UNPUBLISH" | "SALES_CHANNEL_DETACH" | "PROJECTION_REMOVE_OR_HIDE"
  status: "executed" | "skipped_no_op"
  executed: boolean
  db_writes: number
}

export interface SalonSeedCleanupWriteResult {
  decision: Extract<
    SalonSeedCleanupDecision,
    "SALON_SEED_CLEANUP_COMMITTED" | "SALON_SEED_CLEANUP_IDEMPOTENT_NOOP"
  >
  executed_actions: ExecutedSeedAction[]
  db_writes: number
  projection_writes: number
}

/**
 * Planlı aksiyonları enjekte edilen mutator ile uygular.
 *
 * Fail-closed: plan DRY_RUN_READY değilse (scope mismatch / blocked / başka karar)
 * hiçbir mutator çağrısı yapılmadan hata fırlatır → db_writes 0.
 *
 * Idempotent: hedef durum zaten sağlanmışsa tüm aksiyonlar `no_op` olur →
 * 0 yazım → IDEMPOTENT_NOOP. Aksi halde COMMITTED.
 */
export async function executeSalonSeedCleanup(
  plan: SalonSeedCleanupPlan,
  mutator: SeedCleanupMutator
): Promise<SalonSeedCleanupWriteResult> {
  if (plan.decision !== "SALON_SEED_CLEANUP_DRY_RUN_READY") {
    throw new Error(
      `[salon-seed:cleanup] Fail-closed: plan commit'e uygun değil (decision=${plan.decision}). Yazım yapılmadı.`
    )
  }

  const executed: ExecutedSeedAction[] = []
  let dbWrites = 0
  let projectionWrites = 0

  for (const action of plan.planned_actions) {
    if (action.status === "no_op") {
      executed.push({
        product_id: action.product_id,
        handle: action.handle,
        action: action.action,
        status: "skipped_no_op",
        executed: false,
        db_writes: 0,
      })
      continue
    }
    // READY planda yalnız "planned" ya da "no_op" bulunur; başka durum beklenmez.
    if (action.status !== "planned") {
      throw new Error(
        `[salon-seed:cleanup] Fail-closed: beklenmedik aksiyon durumu '${action.status}'. Yazım durduruldu.`
      )
    }

    let writes = 0
    if (action.action === "PRODUCT_UNPUBLISH") {
      await mutator.unpublishProduct(action.product_id)
      writes = 1
    } else if (action.action === "SALES_CHANNEL_DETACH") {
      const channelIds = readChannelIds(action.detail)
      await mutator.detachSalesChannels(action.product_id, channelIds)
      writes = channelIds.length
    } else if (action.action === "PROJECTION_REMOVE_OR_HIDE") {
      const projectionId = readProjectionId(action.detail)
      if (!projectionId) {
        throw new Error(
          `[salon-seed:cleanup] Fail-closed: projection_id eksik (product=${action.product_id}).`
        )
      }
      await mutator.removeProjection(projectionId)
      writes = 1
      projectionWrites += 1
    }

    dbWrites += writes
    executed.push({
      product_id: action.product_id,
      handle: action.handle,
      action: action.action,
      status: "executed",
      executed: true,
      db_writes: writes,
    })
  }

  const anyExecuted = executed.some((a) => a.executed)
  return {
    decision: anyExecuted
      ? "SALON_SEED_CLEANUP_COMMITTED"
      : "SALON_SEED_CLEANUP_IDEMPOTENT_NOOP",
    executed_actions: executed,
    db_writes: dbWrites,
    projection_writes: projectionWrites,
  }
}

function readChannelIds(detail: Record<string, unknown>): string[] {
  const ids = detail?.current_sales_channel_ids
  if (!Array.isArray(ids)) return []
  return ids.filter((id): id is string => typeof id === "string")
}

function readProjectionId(detail: Record<string, unknown>): string | null {
  const id = detail?.projection_id
  return typeof id === "string" && id.length > 0 ? id : null
}
