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
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">{t("lotCosting.title", "Stok ve Maliyet Partileri")}</Heading>
        {variants.length > 1 ? (
          <select className="bg-ui-bg-field border-ui-border-base rounded-md border px-2 py-1 text-sm" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
            {variants.map((v) => (<option key={v.id} value={v.id}>{v.title ?? v.id}</option>))}
          </select>
        ) : null}
      </div>

      <div className="flex flex-col gap-y-4 px-6 pb-6">
        {loading ? (
          <Text size="small" className="text-ui-fg-subtle">{t("common.loading", "Yükleniyor…")}</Text>
        ) : (
          <>
            {/* Lot tablosu */}
            <div>
              <Text weight="plus" size="small" className="mb-2">{t("lotCosting.lotsSection", "Partiler")}</Text>
              {(summary?.lots ?? []).length === 0 ? (
                <Text size="small" className="text-ui-fg-subtle">{t("lotCosting.empty", "Henüz maliyet partisi yok. Yeni Stok Girişi ile ekleyin.")}</Text>
              ) : (
                <div className="flex flex-col gap-y-1">
                  {(summary?.lots ?? []).map((l) => (
                    <div key={l.lot_id} className="border-ui-border-base flex items-center justify-between border-b py-1 text-sm">
                      <span>{l.lot_number ?? l.lot_id.slice(0, 10)} · {new Date(l.received_at).toLocaleDateString("tr-TR")}</span>
                      <span className="flex items-center gap-x-2">
                        <Badge size="2xsmall">{t("lotCosting.stock", "Stok")}: {l.remaining_quantity}</Badge>
                        {l.effective_unit_cost != null ? <Badge size="2xsmall" color="green">₺{l.effective_unit_cost}</Badge> : null}
                        <Badge size="2xsmall" color={l.status === "active" ? "blue" : "grey"}>{l.status}</Badge>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Maliyet ve fiyat (owner) */}
            {isOwner ? (
              <div className="bg-ui-bg-subtle rounded-md p-3">
                <Text weight="plus" size="small" className="mb-2">{t("lotCosting.costPricing", "Maliyet ve Fiyatlandırma")}</Text>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <span>FIFO: ₺{summary?.cost?.fifo ?? "—"}</span>
                  <span>{t("lotCosting.wac", "Ağırlıklı")}: ₺{summary?.cost?.weighted_average_cost ?? "—"}</span>
                  <span>{t("lotCosting.last", "Son alış")}: ₺{summary?.cost?.last_purchase_cost ?? "—"}</span>
                  <span>{t("lotCosting.minSafe", "Min güvenli")}: ₺{rec?.minimum_safe_price ?? "—"}</span>
                  <span>{t("lotCosting.recommended", "Tavsiye")}: ₺{rec?.default_recommended_price ?? "—"}</span>
                  <span>{t("lotCosting.stockValue", "Stok değeri")}: ₺{summary?.stock_value ?? "—"}</span>
                </div>
                {rec?.loss_risk ? <Badge size="2xsmall" color="red">{t("lotCosting.lossRisk", "Zarar Riski")}</Badge> : null}
                {rec?.default_recommended_price != null ? (
                  <div className="mt-3">
                    {confirmPrice === null ? (
                      <Button size="small" variant="secondary" onClick={() => setConfirmPrice(rec.default_recommended_price!)}>
                        {t("lotCosting.applyPrice", "Satış Fiyatına Uygula")}
                      </Button>
                    ) : (
                      <div className="border-ui-border-base rounded-md border p-3">
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

            {/* Yeni stok girişi (owner) */}
            {isOwner ? (
              <div className="border-ui-border-base rounded-md border p-3">
                <Text weight="plus" size="small" className="mb-2">{t("lotCosting.newEntry", "Yeni Stok Girişi")}</Text>
                <div className="grid grid-cols-2 gap-2">
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
                      <Input size="small" value={(form as never)[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-x-3">
                  <Button size="small" variant="primary" onClick={submitEntry}>{t("lotCosting.saveEntry", "Stok Girişi Kaydet")}</Button>
                  {msg ? <Text size="xsmall" className="text-ui-fg-subtle">{msg}</Text> : null}
                </div>
              </div>
            ) : null}

            {summary?.unvalued_opening_stock ? <Badge size="2xsmall" color="orange">{t("lotCosting.unvalued", "Maliyet Eksik")}</Badge> : null}
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
