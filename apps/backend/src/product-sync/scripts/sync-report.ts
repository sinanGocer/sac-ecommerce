import { promises as fs } from "fs"
import path from "path"

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { REPORTS_DIR, PriceChangeStore } from "../services/sync.service"
import { SyncReport } from "../types/product-sync.types"

/**
 * Son senkron raporunu ve bekleyen fiyat değişikliklerini okunur biçimde listeler.
 *
 * Yapılandırma ENV ile (opsiyonel):
 *   SYNC_PROVIDER=aveda   (varsayılan aveda)
 *
 * Kullanım:
 *   npm run sync:report
 */
export default async function syncReport({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const provider = process.env.SYNC_PROVIDER || "aveda"

  const file = path.join(REPORTS_DIR, `${provider}-latest.json`)

  let report: SyncReport
  try {
    const buf = await fs.readFile(file, "utf-8")
    report = JSON.parse(buf) as SyncReport
  } catch {
    logger.warn(
      `Rapor bulunamadı: ${file}. Önce 'npm run sync:aveda:dry' çalıştırın.`
    )
    return
  }

  logger.info(`═══════ SENKRON RAPORU (${report.provider}) ═══════`)
  logger.info(
    `Tarih: ${report.finishedAt} | dryRun: ${report.dryRun} | toplam: ${report.total}`
  )
  logger.info(
    `create=${report.summary.create} update=${report.summary.update} review=${report.summary.review} skip=${report.summary.skip} hata=${report.summary.errors}`
  )
  logger.info("────────────────────────────────")

  for (const r of report.results) {
    const price =
      r.pricing.medusaPrice !== null ? `${r.pricing.medusaPrice} TRY` : "—"
    logger.info(`• [${r.action.toUpperCase()}] ${r.name}`)
    logger.info(
      `    fiyat: ${price} | indirim: ${r.pricing.discountDetected ? "evet" : "hayır"} | url: ${r.sourceUrl}`
    )
    if (r.warnings.length) logger.info(`    uyarı: ${r.warnings.join(" | ")}`)
    if (r.errors.length) logger.info(`    HATA: ${r.errors.join(" | ")}`)
  }

  const pending = (await PriceChangeStore.readAll()).filter(
    (c) => c.status === "pending"
  )
  logger.info("──────── BEKLEYEN FİYAT DEĞİŞİKLİKLERİ ────────")
  if (pending.length === 0) {
    logger.info("Bekleyen fiyat değişikliği yok.")
  } else {
    for (const c of pending) {
      logger.info(
        `change_id=${c.id} | ${c.name} | ${c.field}: ${c.oldValue} → ${c.newValue} (%${c.discountRate ?? "?"})`
      )
    }
    logger.info("Onay:  SYNC_CHANGE_ID=<change_id> npm run sync:approve")
    logger.info("Ret :  SYNC_CHANGE_ID=<change_id> npm run sync:reject")
  }
}
