import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Badge, Button, Container, Heading, Input, Label, Text } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

/**
 * Ürün detayı: Stok ve Maliyet Partileri + Maliyet/Fiyat + Yeni Stok Girişi.
 * Veri rol bazında redaktedir (catalog_editor maliyet görmez). Gerçek satış
 * fiyatı OTOMATİK değişmez; "Satış Fiyatına Uygula" yalnız onaylı + owner.
 */
type Summary = {
  variant_id: string
  viewer_role: string
  lot_count: number
  total_remaining_quantity: number
  stock_value?: number
  cost?: { fifo: number | null; weighted_average_cost: number | null; last_purchase_cost: number | null }
  price_recommendation?: {
    default_recommended_price: number | null
    minimum_safe_price: number | null
    loss_risk?: boolean
  }
  unvalued_opening_stock?: boolean
  lots?: Array<{ lot_id: string; received_at: string; remaining_quantity: number; effective_unit_cost?: number; status: string; lot_number?: string | null; supplier_name?: string | null }>
}

type Variant = { id: string; title?: string }

const num = (v: string) => (v.trim() === "" ? 0 : Number(v))
const money = (v?: number | null) => (v == null ? "—" : `₺${v}`)

const LotCostPanel = ({ data }: { data: { id: string; variants?: Variant[] } }) => {
  const { t } = useTranslation()
  const variants = data.variants ?? []
  const [variantId, setVariantId] = useState<string>(variants[0]?.id ?? "")
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string>("")
  const [confirmPrice, setConfirmPrice] = useState<number | null>(null)
  const [form, setForm] = useState({ received_quantity: "", unit_purchase_cost: "", purchase_vat_rate: "20", supplier_name: "", invoice_number: "", lot_number: "", location_id: "" })

  const isOwner = summary?.viewer_role === "owner"

  const load = async (vid: string) => {
    if (!vid) return
    setLoading(true)
    try {
      const r = await fetch(`/admin/lot-costing/variants/${vid}`, { credentials: "include" })
      setSummary(r.ok ? await r.json() : null)
    } catch {
      setSummary(null)
    }
    setLoading(false)
  }

  useEffect(() => {
    if (variantId) load(variantId)
  }, [variantId])

  const submitEntry = async () => {
    setMsg("")
    const body = {
      product_id: data.id,
      variant_id: variantId,
      received_quantity: num(form.received_quantity),
      unit_purchase_cost: num(form.unit_purchase_cost),
      purchase_vat_rate: num(form.purchase_vat_rate) / 100,
      supplier_name: form.supplier_name,
      invoice_number: form.invoice_number,
      lot_number: form.lot_number,
      location_id: form.location_id,
      idempotency_key: `ui-${variantId}-${form.lot_number}-${Date.now()}`,
    }
    if (!body.received_quantity || !body.unit_purchase_cost || !body.supplier_name || !body.invoice_number || !body.lot_number || !body.location_id) {
      setMsg(t("common.required", "Bu alan zorunludur"))
      return
    }
    try {
      const r = await fetch(`/admin/lot-costing/stock-entry`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      if (r.status === 503) setMsg("Stok girişi kapalı (LOT_COSTING_WRITE_ENABLED).")
      else if (r.status === 403) setMsg("Yetki yok (yalnız owner/admin).")
      else if (r.ok) { setMsg(t("common.saved", "Kaydedildi")); load(variantId) }
      else setMsg(t("common.error", "Bir hata oluştu"))
    } catch {
      setMsg(t("common.error", "Bir hata oluştu"))
    }
  }

  const rec = summary?.price_recommendation
  return (
    <Container className="overflow-hidden p-0">
      <div className="border-ui-border-base bg-ui-bg-subtle flex flex-col gap-3 border-b px-6 py-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Heading level="h2">{t("lotCosting.title", "Stok ve Maliyet Partileri")}</Heading>
            {summary?.unvalued_opening_stock ? <Badge size="2xsmall" color="orange">{t("lotCosting.unvalued", "Maliyet Eksik")}</Badge> : null}
          </div>
          <Text size="small" className="text-ui-fg-subtle">
            {t("lotCosting.panelHint", "Parti bazlı stok, maliyet ve fiyat önerisini tek ekranda izleyin.")}
          </Text>
        </div>
        {variants.length > 1 ? (
          <select className="bg-ui-bg-field border-ui-border-base rounded-md border px-3 py-2 text-sm" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
            {variants.map((v) => (<option key={v.id} value={v.id}>{v.title ?? v.id}</option>))}
          </select>
        ) : null}
      </div>

      <div className="flex flex-col gap-y-4 px-6 py-5">
        {loading ? (
          <div className="border-ui-border-base bg-ui-bg-base rounded-md border p-6 text-center">
            <Text size="small" className="text-ui-fg-subtle">{t("common.loading", "Yükleniyor…")}</Text>
          </div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="border-ui-border-base rounded-md border p-3">
                <Text size="xsmall" className="text-ui-fg-subtle">{t("lotCosting.totalStock", "Toplam stok")}</Text>
                <Text size="large" weight="plus">{summary?.total_remaining_quantity ?? 0}</Text>
              </div>
              <div className="border-ui-border-base rounded-md border p-3">
                <Text size="xsmall" className="text-ui-fg-subtle">{t("lotCosting.lotCount", "Aktif parti")}</Text>
                <Text size="large" weight="plus">{summary?.lot_count ?? 0}</Text>
              </div>
              <div className="border-ui-border-base rounded-md border p-3">
                <Text size="xsmall" className="text-ui-fg-subtle">{t("lotCosting.recommended", "Tavsiye")}</Text>
                <Text size="large" weight="plus">{money(rec?.default_recommended_price)}</Text>
              </div>
            </div>

            <div className="border-ui-border-base rounded-md border">
              <div className="border-ui-border-base flex items-center justify-between border-b px-4 py-3">
                <Text weight="plus" size="small">{t("lotCosting.lotsSection", "Partiler")}</Text>
                <Badge size="2xsmall" color="grey">{(summary?.lots ?? []).length}</Badge>
              </div>
              {(summary?.lots ?? []).length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Text size="small" weight="plus">{t("lotCosting.emptyTitle", "Henüz parti yok")}</Text>
                  <Text size="small" className="text-ui-fg-subtle">{t("lotCosting.empty", "Henüz maliyet partisi yok. Yeni Stok Girişi ile ekleyin.")}</Text>
                </div>
              ) : (
                <div className="divide-ui-border-base divide-y">
                  {(summary?.lots ?? []).map((l) => (
                    <div key={l.lot_id} className="grid gap-3 px-4 py-3 text-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                      <div className="min-w-0">
                        <Text size="small" weight="plus">{l.lot_number ?? l.lot_id.slice(0, 10)}</Text>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          {new Date(l.received_at).toLocaleDateString("tr-TR")}
                          {l.supplier_name ? ` · ${l.supplier_name}` : ""}
                        </Text>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 md:justify-end">
                        <Badge size="2xsmall">{t("lotCosting.stock", "Stok")}: {l.remaining_quantity}</Badge>
                        {l.effective_unit_cost != null ? <Badge size="2xsmall" color="green">{money(l.effective_unit_cost)}</Badge> : null}
                        <Badge size="2xsmall" color={l.status === "active" ? "blue" : "grey"}>{l.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {isOwner ? (
              <div className="border-ui-border-base bg-ui-bg-subtle rounded-md border p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <Text weight="plus" size="small">{t("lotCosting.costPricing", "Maliyet ve Fiyatlandırma")}</Text>
                  {rec?.loss_risk ? <Badge size="2xsmall" color="red">{t("lotCosting.lossRisk", "Zarar Riski")}</Badge> : null}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    ["FIFO", money(summary?.cost?.fifo)],
                    [t("lotCosting.wac", "Ağırlıklı"), money(summary?.cost?.weighted_average_cost)],
                    [t("lotCosting.last", "Son alış"), money(summary?.cost?.last_purchase_cost)],
                    [t("lotCosting.minSafe", "Min güvenli"), money(rec?.minimum_safe_price)],
                    [t("lotCosting.recommended", "Tavsiye"), money(rec?.default_recommended_price)],
                    [t("lotCosting.stockValue", "Stok değeri"), money(summary?.stock_value)],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-ui-bg-base border-ui-border-base rounded-md border p-3">
                      <Text size="xsmall" className="text-ui-fg-subtle">{label}</Text>
                      <Text size="small" weight="plus">{value}</Text>
                    </div>
                  ))}
                </div>
                {rec?.default_recommended_price != null ? (
                  <div className="mt-3">
                    {confirmPrice === null ? (
                      <Button size="small" variant="secondary" onClick={() => setConfirmPrice(rec.default_recommended_price!)}>
                        {t("lotCosting.applyPrice", "Satış Fiyatına Uygula")}
                      </Button>
                    ) : (
                      <div className="bg-ui-bg-base border-ui-border-base rounded-md border p-3">
                        <Text size="small">{t("lotCosting.confirmApply", "Yeni satış fiyatı")}: ₺{confirmPrice}</Text>
                        <Text size="xsmall" className="text-ui-fg-subtle">{t("lotCosting.applyNote", "Bu sürümde gerçek fiyat değiştirilmez (önizleme/onay).")}</Text>
                        <div className="mt-2 flex gap-x-2">
                          <Button size="small" variant="primary" onClick={() => { setConfirmPrice(null); setMsg(t("lotCosting.applyMock", "Onaylandı (önizleme; gerçek fiyat değişmedi).")) }}>{t("common.confirm", "Onayla")}</Button>
                          <Button size="small" variant="secondary" onClick={() => setConfirmPrice(null)}>{t("common.cancel", "İptal")}</Button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ) : (
              <Badge size="2xsmall" color="grey">{t("lotCosting.costHidden", "Maliyet gizli")}</Badge>
            )}

            {isOwner ? (
              <div className="border-ui-border-base rounded-md border p-4">
                <div className="mb-3">
                  <Text weight="plus" size="small">{t("lotCosting.newEntry", "Yeni Stok Girişi")}</Text>
                  <Text size="xsmall" className="text-ui-fg-subtle">{t("lotCosting.newEntryHint", "Fatura, tedarikçi ve depo bilgisiyle izlenebilir parti oluşturun.")}</Text>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {([
                    ["received_quantity", "Miktar"],
                    ["unit_purchase_cost", "Birim Alış (₺)"],
                    ["purchase_vat_rate", "KDV %"],
                    ["supplier_name", "Tedarikçi"],
                    ["invoice_number", "Fatura No"],
                    ["lot_number", "Lot No"],
                    ["location_id", "Depo (location_id)"],
                  ] as const).map(([k, label]) => (
                    <div key={k}>
                      <Label size="xsmall">{label}</Label>
                      <Input size="small" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button size="small" variant="primary" onClick={submitEntry}>{t("lotCosting.saveEntry", "Stok Girişi Kaydet")}</Button>
                  {msg ? <Text size="xsmall" className="text-ui-fg-subtle">{msg}</Text> : null}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.before",
})

export default LotCostPanel
