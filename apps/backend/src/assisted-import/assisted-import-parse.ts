/**
 * User-Assisted Import — giriş ayrıştırma (SAF, IO yok).
 *
 * .txt  → satır başına ürün URL (# ile yorum, boş satır atlanır)
 * .csv  → başlık satırı: url,title,price,sku,ean (sıra/eksik kolon toleranslı)
 * .html → kaydedilmiş sayfa içeriği (tek kayıt; çıkarım extract aşamasında)
 */

import { ImportInputFormat, ImportInputRecord } from "./assisted-import-policy"

export function detectFormat(filename: string): ImportInputFormat {
  const f = filename.toLowerCase()
  if (f.endsWith(".csv")) return "csv"
  if (f.endsWith(".html") || f.endsWith(".htm")) return "html"
  return "txt"
}

export function parseTxt(content: string): ImportInputRecord[] {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"))
    .map((url, i) => ({
      source_format: "txt" as ImportInputFormat,
      url,
      title: null,
      price: null,
      sku: null,
      ean: null,
      html: null,
      ref: `txt:line:${i + 1}`,
    }))
}

/** Basit CSV ayrıştırıcı: tırnaklı alan + virgül destekler. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') inQuotes = false
      else cur += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ",") { out.push(cur); cur = "" }
    else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

function parsePrice(value: string | undefined): number | null {
  if (!value) return null
  // "1.234,56" (TR) veya "1234.56" toleransı.
  const cleaned = value.replace(/[^\d.,]/g, "")
  let normalized = cleaned
  if (cleaned.includes(",") && cleaned.includes(".")) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".")
  } else if (cleaned.includes(",")) {
    normalized = cleaned.replace(",", ".")
  }
  const n = Number(normalized)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function parseCsv(content: string): ImportInputRecord[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return []

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase())
  const idx = (name: string) => header.indexOf(name)
  const iUrl = idx("url")
  const iTitle = idx("title")
  const iPrice = idx("price")
  const iSku = idx("sku")
  const iEan = idx("ean")
  const iImage = idx("image")
  const iVolume = idx("volume")
  const iCategory = idx("category")
  const iClassification = idx("classification")
  const iSourceFile = idx("source_file")

  // Başlık yoksa (ilk satır url ise) header'sız mod.
  const hasHeader = iUrl !== -1 || iTitle !== -1
  const dataLines = hasHeader ? lines.slice(1) : lines

  return dataLines.map((line, i) => {
    const cols = parseCsvLine(line)
    const get = (j: number) => (j >= 0 && j < cols.length ? cols[j] : undefined)
    const url = hasHeader ? get(iUrl) : cols[0]
    return {
      source_format: "csv" as ImportInputFormat,
      url: url && url.length ? url : null,
      title: (hasHeader ? get(iTitle) : cols[1]) || null,
      price: parsePrice(hasHeader ? get(iPrice) : cols[2]),
      sku: (hasHeader ? get(iSku) : cols[3]) || null,
      ean: (hasHeader ? get(iEan) : cols[4]) || null,
      images: (hasHeader ? get(iImage) : undefined)
        ? [get(iImage)!]
        : null,
      volume: (hasHeader ? get(iVolume) : undefined) || null,
      category: (hasHeader ? get(iCategory) : undefined) || null,
      classification: (hasHeader ? get(iClassification) : undefined) || null,
      source_file: (hasHeader ? get(iSourceFile) : undefined) || null,
      html: null,
      ref: `csv:row:${i + 1}`,
    }
  })
}

export function parseHtmlFile(content: string, ref: string): ImportInputRecord[] {
  return [
    {
      source_format: "html",
      url: null,
      title: null,
      price: null,
      sku: null,
      ean: null,
      html: content,
      ref: `html:${ref}`,
    },
  ]
}

export function parseInput(
  format: ImportInputFormat,
  content: string,
  ref = "input"
): ImportInputRecord[] {
  if (format === "csv") return parseCsv(content)
  if (format === "html") return parseHtmlFile(content, ref)
  return parseTxt(content)
}
