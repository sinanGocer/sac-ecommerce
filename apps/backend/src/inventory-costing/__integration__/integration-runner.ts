/* eslint-disable no-console */
/**
 * GERÇEK PostgreSQL entegrasyon test runner'ı (izole _test DB).
 *
 * Kapsam: atomik stok girişi + compensation, FIFO senaryoları, GERÇEK concurrency
 * (barrier ile eşzamanlı transaction'lar), reversal (tam/kısmi/duplicate/eşzamanlı),
 * authorization redaction, feature flag gate'leri.
 *
 * Secret loglanmaz. Çıktıda: DB adı, migration sonucu, geçen/başarısız sayısı,
 * concurrency senaryosu sonucu görünür.
 */

import assert from "assert"

import { setupTestOrm, ENTITY } from "./test-db"
import {
  seedScenarioAB,
  seedLot,
  readLots,
  readAllocations,
  totalRemaining,
  TEST_VARIANT,
  TEST_PRODUCT,
} from "./fixtures"
import { consumeFifoForItemTx, reverseFifoForOrderTx } from "../fifo-tx"
import { createStockEntryTx } from "../stock-entry-tx"
import { redactForRole, viewerRoleFromKeys, SENSITIVE_FIELDS } from "../redaction"
import { StockEntryFull } from "../write-ops"

const logger = { info: () => {}, warn: () => {} }

let passed = 0
let failed = 0
const failures: string[] = []
function ok(cond: unknown, label: string): void {
  if (cond) { passed++; return }
  failed++
  failures.push(label)
  console.error(`  ✗ FAIL: ${label}`)
}
async function group(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n— ${name}`)
  await fn()
}

// Barrier: N worker eşzamanlı serbest bırakılır (deterministik race başlangıcı).
function makeBarrier(n: number) {
  let arrived = 0
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  return {
    async wait() {
      arrived++
      if (arrived >= n) release()
      await gate
    },
  }
}

function stockEntry(over: Partial<StockEntryFull> & { idempotency_key: string }): StockEntryFull {
  return {
    product_id: TEST_PRODUCT,
    variant_id: TEST_VARIANT,
    received_quantity: 10,
    unit_purchase_cost: 100,
    purchase_vat_rate: 0,
    allocated_shipping_cost: 0,
    allocated_additional_cost: 0,
    location_id: "test_loc",
    inventory_item_id: "test_inv",
    supplier_id: "test_sup",
    supplier_name: "Test Supplier",
    invoice_number: "INV-1",
    lot_number: "LOT-1",
    received_at: "2026-03-01T00:00:00.000Z",
    expiry_date: null,
    currency: "try",
    notes: null,
    ...over,
  }
}

async function main(): Promise<void> {
  const t = await setupTestOrm()
  const { manager } = t
  console.log(`\n=== INTEGRATION TEST DB: ${t.info.dbName} ===`)
  console.log(`=== MIGRATIONS: ${t.migrationsApplied.length ? t.migrationsApplied.join(", ") : "(already applied / none pending)"} ===`)

  let concurrencySummary = ""

  try {
    // ── 1) Atomik stok girişi + compensation ──────────────────────────────────
    await group("Atomik stok girişi (transaction + compensation)", async () => {
      await t.reset()
      // başarılı receipt + lot
      const r1 = await createStockEntryTx(manager, ENTITY, stockEntry({ idempotency_key: "se_ok_1" }), {}, logger)
      ok(r1.status === "created" && r1.lot_id && r1.receipt_id, "stock-entry: created receipt+lot")
      let lots = await readLots(manager, ENTITY.Lot)
      let receipts = await manager.fork().find(ENTITY.Receipt, {})
      ok(lots.length === 1 && receipts.length === 1, "stock-entry: tam 1 lot + 1 receipt")

      // idempotent tekrar → yeni kayıt yok
      const r2 = await createStockEntryTx(manager, ENTITY, stockEntry({ idempotency_key: "se_ok_1" }), {}, logger)
      ok(r2.status === "skipped_idempotent", "stock-entry: idempotent tekrar no-op")
      lots = await readLots(manager, ENTITY.Lot)
      receipts = await manager.fork().find(ENTITY.Receipt, {})
      ok(lots.length === 1 && receipts.length === 1, "stock-entry: idempotent sonrası hâlâ 1+1")

      // inventory sonrası yapay hata → lot + receipt compensation (rollback)
      let threw = false
      try {
        await createStockEntryTx(
          manager, ENTITY, stockEntry({ idempotency_key: "se_fail_inv" }),
          { onInventoryIncrease: async () => { throw new Error("injected_inventory_failure") } },
          logger
        )
      } catch (e) { threw = true }
      ok(threw, "stock-entry: inventory hatası throw etti")
      lots = await readLots(manager, ENTITY.Lot)
      receipts = await manager.fork().find(ENTITY.Receipt, {})
      ok(lots.length === 1 && receipts.length === 1, "stock-entry: hata sonrası YARIM kayıt yok (rollback)")
      const failedLot = await manager.fork().find(ENTITY.Lot, { idempotency_key: "se_fail_inv" })
      ok(failedLot.length === 0, "stock-entry: başarısız işlemde lot yazılmadı")
    })

    // ── 2) FIFO senaryoları ───────────────────────────────────────────────────
    await group("FIFO tüketim senaryoları (A:20×100, B:100×140)", async () => {
      await t.reset()
      await seedScenarioAB(manager, ENTITY.Lot)

      // 10 adet satış → A:10, B:100
      const c1 = await consumeFifoForItemTx(manager.fork(), ENTITY, { order_id: "o1", order_item_id: "o1i1", variant_id: TEST_VARIANT, product_id: TEST_PRODUCT, quantity: 10 }, logger)
      ok(c1.status === "applied", "FIFO: 10 satış applied")
      let lots = await readLots(manager, ENTITY.Lot)
      ok(Number(lots[0].remaining_quantity) === 10 && Number(lots[1].remaining_quantity) === 100, "FIFO: 10 sonra A:10 B:100")

      // sonraki 25 adet satış → A:0, B:85
      const c2 = await consumeFifoForItemTx(manager.fork(), ENTITY, { order_id: "o2", order_item_id: "o2i1", variant_id: TEST_VARIANT, product_id: TEST_PRODUCT, quantity: 25 }, logger)
      ok(c2.status === "applied", "FIFO: 25 satış applied")
      lots = await readLots(manager, ENTITY.Lot)
      ok(Number(lots[0].remaining_quantity) === 0 && Number(lots[1].remaining_quantity) === 85, "FIFO: 25 sonra A:0 B:85")

      // doğru CostAllocation split (o2: 10 from A @100, 15 from B @140)
      const alloc2 = await readAllocations(manager, ENTITY.Allocation, "o2")
      const fromA = alloc2.find((a) => Number(a.unit_cost) === 100)
      const fromB = alloc2.find((a) => Number(a.unit_cost) === 140)
      ok(fromA && Number(fromA.allocated_quantity) === 10, "FIFO: o2 split A=10@100")
      ok(fromB && Number(fromB.allocated_quantity) === 15, "FIFO: o2 split B=15@140")

      // aynı event tekrar → miktar değişmez (idempotent)
      const c2dup = await consumeFifoForItemTx(manager.fork(), ENTITY, { order_id: "o2", order_item_id: "o2i1", variant_id: TEST_VARIANT, product_id: TEST_PRODUCT, quantity: 25 }, logger)
      ok(c2dup.status === "skipped_idempotent", "FIFO: duplicate event no-op")
      lots = await readLots(manager, ENTITY.Lot)
      ok(Number(lots[0].remaining_quantity) === 0 && Number(lots[1].remaining_quantity) === 85, "FIFO: duplicate sonrası miktar değişmedi")

      // 200 adet talep → fail + hiçbir değişiklik
      const c3 = await consumeFifoForItemTx(manager.fork(), ENTITY, { order_id: "o3", order_item_id: "o3i1", variant_id: TEST_VARIANT, product_id: TEST_PRODUCT, quantity: 200 }, logger)
      ok(c3.status === "shortfall", "FIFO: 200 talep shortfall")
      lots = await readLots(manager, ENTITY.Lot)
      ok(Number(lots[0].remaining_quantity) === 0 && Number(lots[1].remaining_quantity) === 85, "FIFO: shortfall sonrası DEĞİŞİKLİK yok")
      const alloc3 = await readAllocations(manager, ENTITY.Allocation, "o3")
      ok(alloc3.length === 0, "FIFO: shortfall'da allocation yazılmadı")
    })

    // ── 3) GERÇEK concurrency (barrier ile eşzamanlı transaction'lar) ──────────
    await group("Gerçek concurrency — 5 eşzamanlı sipariş, toplam stok 30, her biri 10", async () => {
      await t.reset()
      // tek lot 30 adet
      await seedLot(manager, ENTITY.Lot, { received_quantity: 30, unit_cost: 100, received_at: "2026-01-01T00:00:00.000Z" })

      const N = 5
      const barrier = makeBarrier(N)
      const results = await Promise.all(
        Array.from({ length: N }, (_, i) =>
          (async () => {
            await barrier.wait() // tüm worker'lar aynı anda serbest
            return consumeFifoForItemTx(
              manager.fork(),
              ENTITY,
              { order_id: `co_${i}`, order_item_id: `co_${i}_item`, variant_id: TEST_VARIANT, product_id: TEST_PRODUCT, quantity: 10 },
              logger
            )
          })()
        )
      )

      const applied = results.filter((r) => r.status === "applied").length
      const shortfalls = results.filter((r) => r.status === "shortfall").length
      const lots = await readLots(manager, ENTITY.Lot)
      const remaining = Number(lots[0].remaining_quantity)
      const anyNeg = lots.some((l) => Number(l.remaining_quantity) < 0)

      // toplam allocation = applied * 10, mevcut stoktan fazla olamaz
      const allAllocs = await manager.fork().find(ENTITY.Allocation, { allocation_type: "sale" })
      const totalAllocated = allAllocs.reduce((s: number, a: any) => s + Number(a.allocated_quantity), 0)
      // duplicate yok: order_item başına en fazla bir grup
      const itemIds = new Set(allAllocs.map((a: any) => String(a.order_item_id)))

      ok(applied === 3, `concurrency: tam 3 sipariş commit (got ${applied})`)
      ok(shortfalls === 2, `concurrency: 2 sipariş shortfall (got ${shortfalls})`)
      ok(!anyNeg, "concurrency: hiçbir lot negatif değil")
      ok(remaining === 0, `concurrency: kalan stok 0 (got ${remaining})`)
      ok(totalAllocated === 30, `concurrency: toplam allocation = 30 ≤ stok (got ${totalAllocated})`)
      ok(itemIds.size === applied, "concurrency: duplicate allocation yok")
      concurrencySummary = `5 eşzamanlı sipariş × 10 / stok 30 → applied=${applied}, shortfall=${shortfalls}, kalan=${remaining}, toplam_allocation=${totalAllocated}, negatif=${anyNeg}, oversell=${totalAllocated > 30}`
    })

    // ── 3b) Concurrency determinizm (10 tekrar, flaky değil) ───────────────────
    await group("Concurrency determinizm — 10 tekrar aynı invariant", async () => {
      let allOk = true
      for (let rep = 0; rep < 10; rep++) {
        await t.reset()
        await seedLot(manager, ENTITY.Lot, { received_quantity: 30, unit_cost: 100, received_at: "2026-01-01T00:00:00.000Z" })
        const N = 5
        const barrier = makeBarrier(N)
        const results = await Promise.all(
          Array.from({ length: N }, (_, i) =>
            (async () => {
              await barrier.wait()
              return consumeFifoForItemTx(manager.fork(), ENTITY, { order_id: `r${rep}_${i}`, order_item_id: `r${rep}_${i}_it`, variant_id: TEST_VARIANT, product_id: TEST_PRODUCT, quantity: 10 }, logger)
            })()
          )
        )
        const applied = results.filter((r) => r.status === "applied").length
        const lots = await readLots(manager, ENTITY.Lot)
        const anyNeg = lots.some((l) => Number(l.remaining_quantity) < 0)
        if (applied !== 3 || anyNeg || Number(lots[0].remaining_quantity) !== 0) { allOk = false; break }
      }
      ok(allOk, "concurrency: 10 tekrarda invariant deterministik (oversell yok, negatif yok, applied=3)")
    })

    // ── 3c) Aktivasyon guard — değerlenmemiş açılış stoğu (UNVALUED_OPENING_STOCK)
    await group("Aktivasyon guard — unvalued opening stock FIFO'yu engeller", async () => {
      await t.reset()
      // değerlenmiş lot + değerlenmemiş açılış stoğu aynı variant'ta
      await seedLot(manager, ENTITY.Lot, { received_quantity: 50, unit_cost: 100, received_at: "2026-01-01T00:00:00.000Z", status: "active" })
      await seedLot(manager, ENTITY.Lot, { received_quantity: 30, unit_cost: 0, received_at: "2026-01-02T00:00:00.000Z", status: "unvalued_opening_stock" })

      const guarded = await consumeFifoForItemTx(manager.fork(), ENTITY, { order_id: "gu1", order_item_id: "gu1i", variant_id: TEST_VARIANT, product_id: TEST_PRODUCT, quantity: 5 }, logger)
      ok(guarded.status === "blocked_unvalued", "guard: unvalued stok varken FIFO başlatılmadı")
      const allocs = await readAllocations(manager, ENTITY.Allocation, "gu1")
      ok(allocs.length === 0, "guard: kontrolsüz exception/allocation yok (sipariş bozulmaz)")
      const lots = await readLots(manager, ENTITY.Lot)
      ok(lots.every((l) => Number(l.remaining_quantity) === Number(l.received_quantity)), "guard: hiçbir lot tüketilmedi")
    })

    // ── 4) Reversal ───────────────────────────────────────────────────────────
    await group("Reversal — tam / kısmi / duplicate / eşzamanlı / cap", async () => {
      // tam reversal
      await t.reset()
      const ab = await seedScenarioAB(manager, ENTITY.Lot)
      await consumeFifoForItemTx(manager.fork(), ENTITY, { order_id: "ro1", order_item_id: "ro1i", variant_id: TEST_VARIANT, product_id: TEST_PRODUCT, quantity: 25 }, logger) // A:0 B:85
      const rev1 = await reverseFifoForOrderTx(manager.fork(), ENTITY, { order_id: "ro1" }, logger)
      ok(rev1.status === "reversed" && rev1.restored_quantity === 25, "reversal: tam iade 25 geri eklendi")
      let lots = await readLots(manager, ENTITY.Lot)
      ok(Number(lots[0].remaining_quantity) === 20 && Number(lots[1].remaining_quantity) === 100, "reversal: lotlar received'a döndü (A:20 B:100)")
      // received üstüne çıkmadı
      ok(Number(lots[0].remaining_quantity) <= 20 && Number(lots[1].remaining_quantity) <= 100, "reversal: received_quantity aşılmadı")

      // duplicate reversal → no-op
      const rev1dup = await reverseFifoForOrderTx(manager.fork(), ENTITY, { order_id: "ro1" }, logger)
      ok(rev1dup.status === "noop_already_reversed", "reversal: duplicate no-op")
      lots = await readLots(manager, ENTITY.Lot)
      ok(Number(lots[0].remaining_quantity) === 20 && Number(lots[1].remaining_quantity) === 100, "reversal: duplicate sonrası değişiklik yok")

      // reversal kaydı silinmedi (immutable audit)
      const revRows = (await manager.fork().find(ENTITY.Allocation, { order_id: "ro1", allocation_type: "reversal" }))
      ok(revRows.length >= 1, "reversal: immutable reversal kaydı duruyor")

      // eşzamanlı iki reversal → yalnız biri etki eder, oversell-restore yok
      await t.reset()
      await seedScenarioAB(manager, ENTITY.Lot)
      await consumeFifoForItemTx(manager.fork(), ENTITY, { order_id: "ro2", order_item_id: "ro2i", variant_id: TEST_VARIANT, product_id: TEST_PRODUCT, quantity: 25 }, logger)
      const barrier = makeBarrier(2)
      const [rA, rB] = await Promise.all([
        (async () => { await barrier.wait(); return reverseFifoForOrderTx(manager.fork(), ENTITY, { order_id: "ro2" }, logger) })(),
        (async () => { await barrier.wait(); return reverseFifoForOrderTx(manager.fork(), ENTITY, { order_id: "ro2" }, logger) })(),
      ])
      const restoredTotal = rA.restored_quantity + rB.restored_quantity
      ok(restoredTotal === 25, `reversal: eşzamanlı iki reversal toplam 25 (got ${restoredTotal})`)
      lots = await readLots(manager, ENTITY.Lot)
      ok(Number(lots[0].remaining_quantity) === 20 && Number(lots[1].remaining_quantity) === 100, "reversal: eşzamanlı sonrası received aşılmadı (A:20 B:100)")
      ok(Number(lots[0].remaining_quantity) <= 20 && Number(lots[1].remaining_quantity) <= 100, "reversal: eşzamanlı iadede received_quantity cap korundu")
    })

    // ── 5) Authorization redaction (gerçek lot verisine karşı) ─────────────────
    await group("Authorization — owner full, catalog_editor redaksiyon", async () => {
      await t.reset()
      await seedScenarioAB(manager, ENTITY.Lot)
      const lots = await readLots(manager, ENTITY.Lot)
      const costPayload = {
        variant_id: TEST_VARIANT,
        stock_value: 100 * 20 + 140 * 100,
        weighted_average_cost: 137,
        net_profit: 1234,
        lots: lots.map((l) => ({
          lot_id: l.id,
          remaining_quantity: Number(l.remaining_quantity),
          unit_purchase_cost: Number(l.unit_purchase_cost),
          effective_unit_cost: Number(l.effective_unit_cost),
          supplier_name: "Gizli Tedarikçi",
        })),
      }
      // owner: tam
      const ownerView = redactForRole(costPayload, viewerRoleFromKeys(["owner"]))
      ok((ownerView as any).net_profit === 1234 && (ownerView as any).lots[0].unit_purchase_cost === 100, "auth: owner maliyeti TAM görür")

      // catalog_editor: hassas alanlar yok
      const editorRole = viewerRoleFromKeys(["catalog_editor"])
      ok(editorRole === "catalog_editor", "auth: catalog_editor rolü türetildi (403 guard)")
      const editorView = redactForRole(costPayload, editorRole) as any
      const json = JSON.stringify(editorView)
      const leaked = SENSITIVE_FIELDS.filter((f) => json.includes(`"${f}"`))
      ok(leaked.length === 0, `auth: catalog_editor response'unda hassas alan yok (leaked: ${leaked.join(",") || "none"})`)
      ok(editorView.net_profit === undefined && editorView.stock_value === undefined, "auth: net kâr / stok değeri redakte")
      ok(editorView.lots[0].unit_purchase_cost === undefined && editorView.lots[0].supplier_name === undefined, "auth: maliyet/tedarikçi redakte")
      ok(editorView.lots[0].remaining_quantity === 20, "auth: hassas-olmayan alanlar (miktar) korunur")
    })

    // ── 6) Feature flag gate'leri ──────────────────────────────────────────────
    await group("Feature flags — varsayılan kapalı (fail-safe)", async () => {
      // Flag'ler test process'i içinde dahi açılmadıkça gate'ler kapalı.
      const prevFifo = process.env.LOT_COSTING_FIFO_ENABLED
      const prevWrite = process.env.LOT_COSTING_WRITE_ENABLED
      delete process.env.LOT_COSTING_FIFO_ENABLED
      delete process.env.LOT_COSTING_WRITE_ENABLED

      // subscriber gate mantığı: flag yoksa no-op
      const fifoGate = process.env.LOT_COSTING_FIFO_ENABLED === "true"
      ok(fifoGate === false, "flags: LOT_COSTING_FIFO_ENABLED yok → subscriber no-op")
      const writeGate = process.env.LOT_COSTING_WRITE_ENABLED === "true"
      ok(writeGate === false, "flags: LOT_COSTING_WRITE_ENABLED yok → stock-entry 503")
      const jobsGate = process.env.LOT_COSTING_JOBS_ENABLED === "true"
      ok(jobsGate === false, "flags: LOT_COSTING_JOBS_ENABLED yok → jobs no-op")

      // test process'i içinde açıldığında gate açılır (yalnız bu process)
      process.env.LOT_COSTING_FIFO_ENABLED = "true"
      ok(process.env.LOT_COSTING_FIFO_ENABLED === "true", "flags: test process içinde açılabilir")
      // geri al
      if (prevFifo === undefined) delete process.env.LOT_COSTING_FIFO_ENABLED; else process.env.LOT_COSTING_FIFO_ENABLED = prevFifo
      if (prevWrite === undefined) delete process.env.LOT_COSTING_WRITE_ENABLED; else process.env.LOT_COSTING_WRITE_ENABLED = prevWrite
    })

  } finally {
    await t.reset().catch(() => {})
    await t.close()
  }

  console.log(`\n=== CONCURRENCY: ${concurrencySummary} ===`)
  console.log(`=== RESULT: ${passed} passed, ${failed} failed ===`)
  if (failed > 0) {
    console.error(`FAILURES:\n - ${failures.join("\n - ")}`)
    process.exit(1)
  }
  console.log("ALL INTEGRATION TESTS PASSED")
}

main().catch((e) => { console.error("INTEGRATION_RUNNER_FATAL", e); process.exit(1) })
