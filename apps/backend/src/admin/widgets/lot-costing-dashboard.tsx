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

  return (
    <Container className="mb-4 p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">{t("lotCosting.dashboard", "Stok Planlama Özeti")}</Heading>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-6 pb-4">
        <Badge size="2xsmall" color="red">{t("lotCosting.orderNow", "Sipariş Ver")}: {d?.order_now ?? 0}</Badge>
        <Badge size="2xsmall" color="orange">{t("lotCosting.soon", "Yakında Tükenecek")}: {d?.soon_stockout ?? 0}</Badge>
        <Badge size="2xsmall" color="blue">{t("lotCosting.overstock", "Fazla Stok")}: {d?.overstock ?? 0}</Badge>
        <Badge size="2xsmall" color="grey">{t("lotCosting.activeLots", "Aktif Parti")}: {d?.active_lots ?? 0}</Badge>
        {d?.stock_value != null ? <Badge size="2xsmall" color="green">{t("lotCosting.stockValue", "Stok değeri")}: ₺{d.stock_value}</Badge> : null}
      </div>
      {d?.note ? <Text size="xsmall" className="text-ui-fg-subtle px-6 pb-4">{d.note}</Text> : null}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.list.before",
})

export default LotCostingDashboard
