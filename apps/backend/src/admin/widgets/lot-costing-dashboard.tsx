import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

/** Stok planlama özeti (sipariş listesi üstü). Stok değeri yalnız owner'a gelir. */
type Dash = {
  viewer_role: string
  order_now?: number
  soon_stockout?: number
  overstock?: number
  active_lots?: number
  stock_value?: number
  note?: string
}

const LotCostingDashboard = () => {
  const { t } = useTranslation()
  const [d, setD] = useState<Dash | null>(null)
  useEffect(() => {
    fetch("/admin/lot-costing/dashboard", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setD)
      .catch(() => setD(null))
  }, [])

  const metrics = [
    { label: t("lotCosting.orderNow", "Sipariş Ver"), value: d?.order_now ?? 0, tone: "red" as const },
    { label: t("lotCosting.soon", "Yakında Tükenecek"), value: d?.soon_stockout ?? 0, tone: "orange" as const },
    { label: t("lotCosting.overstock", "Fazla Stok"), value: d?.overstock ?? 0, tone: "blue" as const },
    { label: t("lotCosting.activeLots", "Aktif Parti"), value: d?.active_lots ?? 0, tone: "grey" as const },
  ]

  return (
    <Container className="mb-4 overflow-hidden p-0">
      <div className="border-ui-border-base flex flex-col gap-1 border-b px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-x-2">
            <Heading level="h2">{t("lotCosting.dashboard", "Stok Planlama Özeti")}</Heading>
            <Badge size="2xsmall" color="green">{t("common.live", "Canlı")}</Badge>
          </div>
          {d?.stock_value != null ? (
            <div className="border-ui-border-base bg-ui-bg-subtle rounded-md border px-3 py-1.5">
              <Text size="xsmall" className="text-ui-fg-subtle">{t("lotCosting.stockValue", "Stok değeri")}</Text>
              <Text size="small" weight="plus">₺{d.stock_value}</Text>
            </div>
          ) : null}
        </div>
        <Text size="small" className="text-ui-fg-subtle">
          {t("lotCosting.dashboardHint", "Sipariş, stok riski ve parti durumunu hızlıca kontrol edin.")}
        </Text>
      </div>
      <div className="grid gap-3 px-6 py-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="border-ui-border-base bg-ui-bg-base rounded-md border p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <Text size="small" className="text-ui-fg-subtle">{m.label}</Text>
              <Badge size="2xsmall" color={m.tone}>{m.value > 0 ? t("common.review", "Bak") : t("common.ok", "Tamam")}</Badge>
            </div>
            <Text size="xlarge" weight="plus">{m.value}</Text>
          </div>
        ))}
      </div>
      {d?.note ? <Text size="xsmall" className="text-ui-fg-subtle border-ui-border-base border-t px-6 py-3">{d.note}</Text> : null}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.list.before",
})

export default LotCostingDashboard
