/* eslint-disable no-console */
/**
 * İzole entegrasyon test DB altyapısı — FAIL-CLOSED.
 *
 * Bu modül YALNIZ ayrı bir `*_test` PostgreSQL veritabanına bağlanır ve şemayı
 * gerçek modül migration'larıyla kurar. Production/development DB'ye karşı
 * çalışması KESİNLİKLE engellenir (aşağıdaki guard'lar):
 *
 *   - DB adında "_test" yoksa            → abort
 *   - NODE_ENV !== "test"                → destructive setup yapılmaz, abort
 *   - bilinen dev/prod DB adı algılanırsa → abort
 *   - secret (şifre) asla loglanmaz       → URL maskelenir
 *
 * Böylece yanlışlıkla gerçek veriye (74 published ürün) yazım imkânsızdır.
 */

import path from "path"

import { toMikroOrmEntities, mikroOrmCreateConnection } from "@medusajs/framework/utils"

import InventoryCostLot from "../../modules/lot-costing/models/inventory-cost-lot"
import CostAllocation from "../../modules/lot-costing/models/cost-allocation"
import PurchaseReceipt from "../../modules/lot-costing/models/purchase-receipt"
import CostAdjustment from "../../modules/lot-costing/models/cost-adjustment"
import ProductPricingPolicy from "../../modules/lot-costing/models/product-pricing-policy"
import {
  DemandForecastSnapshot,
  ForecastAccuracy,
  InventoryPlanningPolicy,
  ReorderRecommendation,
} from "../../modules/lot-costing/models/forecasting"

export const TEST_ENTITIES = toMikroOrmEntities([
  InventoryCostLot,
  CostAllocation,
  PurchaseReceipt,
  CostAdjustment,
  ProductPricingPolicy,
  DemandForecastSnapshot,
  ForecastAccuracy,
  InventoryPlanningPolicy,
  ReorderRecommendation,
] as never)

export const ENTITY = {
  Lot: TEST_ENTITIES[0],
  Allocation: TEST_ENTITIES[1],
  Receipt: TEST_ENTITIES[2],
}

/** Bilinen güvenli-olmayan (gerçek) DB adı parçaları — eşleşirse abort. */
const FORBIDDEN_DB_NAMES = [
  "medusa-sac-ecommerce", // development
  "medusa_sac_ecommerce", // (test soneki olmadan)
]

const DEFAULT_TEST_URL = "postgres://postgres@localhost/medusa_sac_ecommerce_test"

function parseDbName(url: string): string {
  // postgres://user:pass@host:port/dbname?params
  const m = url.match(/\/([^/?]+)(\?|$)/)
  return m ? m[1] : ""
}

/** Şifreyi maskele — secret loglama yok. */
export function maskUrl(url: string): string {
  return url.replace(/(:\/\/[^:@/]+:)[^@]+(@)/, "$1***$2")
}

export interface SafeDbInfo {
  url: string
  dbName: string
}

/**
 * FAIL-CLOSED doğrulama. Güvenli değilse THROW (testler başlamaz).
 * Döndürdüğü url yalnız _test DB'ye işaret eder.
 */
export function assertSafeTestDatabase(rawUrl?: string): SafeDbInfo {
  const url = rawUrl || process.env.TEST_DATABASE_URL || DEFAULT_TEST_URL
  const dbName = parseDbName(url)

  if (process.env.NODE_ENV !== "test") {
    throw new Error(`[test-db] ABORT: NODE_ENV='${process.env.NODE_ENV}' (must be 'test' for destructive setup).`)
  }
  if (!dbName.includes("_test")) {
    throw new Error(`[test-db] ABORT: DB name '${dbName}' does not contain '_test' — refusing to touch non-test database.`)
  }
  for (const forbidden of FORBIDDEN_DB_NAMES) {
    if (dbName === forbidden) {
      throw new Error(`[test-db] ABORT: DB name '${dbName}' matches a known dev/prod database.`)
    }
  }
  // Production DB URL'si (env) ile birebir aynıysa abort.
  const prodUrl = process.env.DATABASE_URL
  if (prodUrl && parseDbName(prodUrl) === dbName && !dbName.includes("_test")) {
    throw new Error(`[test-db] ABORT: resolved DB equals DATABASE_URL (non-test).`)
  }
  return { url, dbName }
}

export interface TestOrm {
  orm: any
  manager: any
  info: SafeDbInfo
  migrationsApplied: string[]
  close: () => Promise<void>
  reset: () => Promise<void>
}

const TABLES_TO_RESET = [
  "cost_allocation",
  "inventory_cost_lot",
  "purchase_receipt",
  "cost_adjustment",
  "demand_forecast_snapshot",
  "forecast_accuracy",
  "reorder_recommendation",
  "lot_product_pricing_policy",
  "inventory_planning_policy",
]

/**
 * Test ORM'i kurar: fail-closed doğrulama → bağlan → migration apply.
 * Migration dizini compiled JS yolundan çözülür.
 */
export async function setupTestOrm(): Promise<TestOrm> {
  const info = assertSafeTestDatabase()
  console.log(`[test-db] Using isolated test database: ${info.dbName} (${maskUrl(info.url)})`)

  const migrationsPath = path.join(__dirname, "..", "..", "modules", "lot-costing", "migrations")
  const orm = await mikroOrmCreateConnection(
    { clientUrl: info.url, schema: "public" },
    TEST_ENTITIES,
    migrationsPath
  )

  const migrator = orm.getMigrator()
  const executed = await migrator.up()
  const migrationsApplied: string[] = (executed ?? []).map((m: any) => String(m.name ?? m))
  console.log(`[test-db] Migrations applied: ${migrationsApplied.length ? migrationsApplied.join(", ") : "(none pending)"}`)

  const reset = async (): Promise<void> => {
    const conn = orm.em.getConnection()
    await conn.execute(`truncate table ${TABLES_TO_RESET.map((t) => `"${t}"`).join(", ")} restart identity cascade;`)
  }

  return {
    orm,
    manager: orm.em,
    info,
    migrationsApplied,
    close: async () => { await orm.close(true) },
    reset,
  }
}
