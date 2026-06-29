/* eslint-disable no-console */
import assert from "assert"

import {
  aggregateDiscovery,
  compareDiscovery,
  discoverFromHtml,
  resolveUrl,
  toCsv,
} from "../category-discovery"

let passed = 0
function ok(cond: unknown, label: string): void {
  assert.ok(cond, label)
  passed++
}

const BASE = "https://www.aveda.com.tr"

function main(): void {
  // ── resolveUrl ──────────────────────────────────────────────────────────
  ok(resolveUrl("/product/1/1/a/b/c", BASE) === "https://www.aveda.com.tr/product/1/1/a/b/c", "1 relative resolved")
  ok(resolveUrl("https://www.aveda.com.tr/x", BASE)?.includes("aveda.com.tr"), "2 absolute kept")
  ok(resolveUrl("//www.aveda.com.tr/y", BASE)?.startsWith("https://"), "3 protocol-relative")
  ok(resolveUrl("#", BASE) === null && resolveUrl("javascript:void(0)", BASE) === null, "4 junk skipped")

  // ── discoverFromHtml: relative + absolute + reject + dedup ───────────────
  const html = `
    <a href="/product/100/100/sac-bakim/sampuan/urun-a">A</a>
    <a href="https://www.aveda.com.tr/product/101/101/sac-sekillendirme/sprey/urun-b">B</a>
    <a href="/product/100/100/sac-bakim/sampuan/urun-a">A-dup</a>
    <a href="/product/999/999/kvkk/x/legal-page">KVKK</a>
    <a href="/sac-bakimi">Kategori listeleme</a>
    <a href="https://evil.com/product/1/1/a/b/c">Evil</a>
    <a href="/hesabim">Account</a>
  `
  const res = discoverFromHtml(html, "cat1.html", BASE)
  ok(res.links.length === 2, "5 two valid product links (a,b)")
  ok(res.links.some((l) => l.external_id === "100") && res.links.some((l) => l.external_id === "101"), "6 external ids extracted")
  ok(res.links.every((l) => l.source_file === "cat1.html"), "7 source file audited")
  ok(res.links.every((l) => l.discovery_reason === "anchor_href"), "8 discovery reason audited")
  // kvkk + evil rejected; category listing + account not /product → silently ignored
  ok(res.rejected.some((r) => r.reason.startsWith("forbidden_segment") || r.reason === "not_official_aveda_domain"), "9 kvkk/evil rejected with reason")

  // ── aggregate across files + global dedup + duplicate count ──────────────
  const html2 = `<a href="/product/101/101/sac-sekillendirme/sprey/urun-b">B again</a>
                 <a href="/product/102/102/sac-derisi/tonik/urun-c">C</a>`
  const agg = aggregateDiscovery([
    { html, source_file: "cat1.html" },
    { html: html2, source_file: "cat2.html" },
  ], BASE)
  ok(agg.links.length === 3, "10 global dedup -> 3 unique (100,101,102)")
  ok(agg.duplicate_external_ids["101"] === 2, "11 duplicate 101 counted across files")

  // ── CSV ──────────────────────────────────────────────────────────────────
  const csv = toCsv(agg.links)
  ok(csv.split("\n")[0] === "url,external_id,source_file,discovery_reason", "12 csv header")
  ok(csv.includes("100") && csv.includes("102"), "13 csv rows present")

  // ── compare to existing ──────────────────────────────────────────────────
  const cmp = compareDiscovery(agg, new Set(["100"]))
  ok(cmp.summary.existing === 1 && cmp.summary.new === 2, "14 existing vs new split")
  ok(cmp.summary.duplicate === 1 && cmp.summary.rejected >= 1, "15 duplicate + rejected counts")

  // ── empty input ───────────────────────────────────────────────────────────
  const empty = aggregateDiscovery([], BASE)
  ok(empty.links.length === 0 && Object.keys(empty.duplicate_external_ids).length === 0, "16 empty input safe")

  // ── no-network / no-mutation guard in source ──────────────────────────────
  const fs = require("fs") as typeof import("fs")
  const path = require("path") as typeof import("path")
  const file = path.resolve(process.cwd(), "src", "assisted-import", "category-discovery.ts")
  const content = fs.readFileSync(file, "utf-8")
  ok(!/\bfetch\(|axios|http\.request|core-flows|createProductsWorkflow/i.test(content), "17 no network/mutation in discovery")

  console.log(`[category-discovery:test] ${passed} assertions passed`)
}

try {
  main()
} catch (e) {
  console.error("CATEGORY DISCOVERY TEST FAILED:", e instanceof Error ? e.message : e)
  process.exit(1)
}
