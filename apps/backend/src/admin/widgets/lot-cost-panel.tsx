import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

/**
 * Ürün detayında "Stok ve Maliyet Partileri" özeti (read-only).
 * Backend /admin/lot-costing/variants/:id verisini çeker; yanıt zaten rol
 * bazında redakte edilmiştir (catalog_editor maliyet görmez). Fiyat OTOMATİK
 * değiştirilmez.
 */
type VariantSummary = {
  variant_id: string
  lot_count: number
  total_remaining_quantity: number
  stock_value?: number
  cost?: { fifo: number | null; weighted_average_cost: number | null; last_purchase_cost: number | null }
  price_recommendation?: { default_recommended_price: number | null; minimum_safe_price: number | null }
  unvalued_opening_stock?: boolean
}

const LotCostPanel = ({ data }: { data: { id: string; variants?: Array<{ id: string; title?: string }> } }) => {
  const { t } = useTranslation()
  const [rows, setRows] = useState<VariantSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const run = async () => {
      const variants = data.variants ?? []
      const out: VariantSummary[] = []
      for (const v of variants.slice(0, 25)) {
        try {
          const r = await fetch(`/admin/lot-costing/variants/${v.id}`, { credentials: "include" })
          if (r.ok) out.push(await r.json())
        } catch {
          /* sessiz */
        }
      }
      if (active) {
        setRows(out)
        setLoading(false)
      }
    }
    run()
    return () => {
      active = false
    }
  }, [data.id])

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">{t("lotCosting.title", "Stok ve Maliyet Partileri")}</Heading>
      </div>
      <div className="px-6 pb-4">
        {loading ? (
          <Text size="small" className="text-ui-fg-subtle">{t("common.loading", "Yükleniyor…")}</Text>
        ) : rows.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">{t("lotCosting.empty", "Henüz maliyet partisi yok. Yeni Stok Girişi ile ekleyin.")}</Text>
        ) : (
          <div className="flex flex-col gap-y-2">
            {rows.map((rsum) => (
              <div key={rsum.variant_id} className="flex items-center justify-between border-ui-border-base border-b py-2">
                <Text size="small">{rsum.variant_id}</Text>
                <div className="flex items-center gap-x-2">
                  <Badge size="2xsmall">{t("lotCosting.lots", "Parti")}: {rsum.lot_count}</Badge>
                  <Badge size="2xsmall">{t("lotCosting.stock", "Stok")}: {rsum.total_remaining_quantity}</Badge>
                  {rsum.cost ? (
                    <Badge size="2xsmall" color="green">FIFO: {rsum.cost.fifo ?? "—"}</Badge>
                  ) : (
                    <Badge size="2xsmall" color="grey">{t("lotCosting.costHidden", "Maliyet gizli")}</Badge>
                  )}
                  {rsum.unvalued_opening_stock ? (
                    <Badge size="2xsmall" color="orange">{t("lotCosting.unvalued", "Maliyet Eksik")}</Badge>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.before",
})

export default LotCostPanel
