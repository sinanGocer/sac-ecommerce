import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Badge, Button, Container, Heading, Text } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

/**
 * Admin sayfası: Açılış Stoğu (UNVALUED_OPENING_STOCK) raporu. Owner için maliyet
 * lotu olmayan varyantları listeler. Read-only; otomatik maliyet/lot yok.
 */
type Item = { product_id: string; title: string | null; variant_id: string; variant_title: string | null; current_stock: number }

const OpeningStockPage = () => {
  const { t } = useTranslation()
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)

  useEffect(() => {
    fetch("/admin/lot-costing/opening-stock", { credentials: "include" })
      .then(async (r) => {
        if (r.status === 403) { setForbidden(true); return null }
        return r.ok ? r.json() : null
      })
      .then((j) => { if (j) setItems(j.items ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return (
    <Container className="overflow-hidden p-0">
      <div className="border-ui-border-base bg-ui-bg-subtle flex flex-col gap-3 border-b px-6 py-4 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Heading level="h1">{t("lotCosting.openingStock", "Açılış Stoğu")}</Heading>
            <Badge size="2xsmall" color={items.length > 0 ? "orange" : "green"}>
              {items.length > 0 ? t("lotCosting.needsCost", "Maliyet bekliyor") : t("common.ok", "Tamam")}
            </Badge>
          </div>
          <Text size="small" className="text-ui-fg-subtle max-w-[760px]">
            {t("lotCosting.openingNote", "Maliyet lotu olmayan varyantlar. Owner maliyet girmeli; aksi halde gerçek kâr/fiyat uygulaması bloke.")}
          </Text>
        </div>
        <div className="border-ui-border-base bg-ui-bg-base rounded-md border px-3 py-2 md:min-w-[180px]">
          <Text size="xsmall" className="text-ui-fg-subtle">{t("lotCosting.pendingVariants", "Bekleyen varyant")}</Text>
          <Text size="large" weight="plus">{items.length}</Text>
        </div>
      </div>
      <div className="px-6 py-5">
        {forbidden ? (
          <div className="border-ui-border-base rounded-md border p-6 text-center">
            <Text size="small" weight="plus" className="text-ui-fg-error">{t("lotCosting.forbidden", "Yetki yok (yalnız owner/admin).")}</Text>
          </div>
        ) : loading ? (
          <div className="border-ui-border-base rounded-md border p-6 text-center">
            <Text size="small">{t("common.loading", "Yükleniyor…")}</Text>
          </div>
        ) : items.length === 0 ? (
          <div className="border-ui-border-base rounded-md border px-4 py-10 text-center">
            <Text size="small" weight="plus">{t("lotCosting.allValuedTitle", "Her şey temiz")}</Text>
            <Text size="small" className="text-ui-fg-subtle">{t("lotCosting.allValued", "Tüm varyantların maliyet lotu var.")}</Text>
          </div>
        ) : (
          <div className="border-ui-border-base rounded-md border">
            <div className="border-ui-border-base bg-ui-bg-subtle hidden grid-cols-[minmax(0,1fr)_180px] gap-3 border-b px-4 py-3 sm:grid">
              <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">{t("common.product", "Ürün")}</Text>
              <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">{t("lotCosting.stock", "Stok")}</Text>
            </div>
            {items.map((it) => (
              <div key={it.variant_id} className="border-ui-border-base grid gap-3 border-b px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_180px]">
                <div className="min-w-0">
                  <Text size="small" weight="plus">{it.title}</Text>
                  <Text size="xsmall" className="text-ui-fg-subtle">{it.variant_title ?? it.variant_id}</Text>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-between">
                  <Text size="small" className="text-ui-fg-subtle">{it.current_stock}</Text>
                  <Button size="small" variant="secondary" disabled>{t("lotCosting.addCost", "Maliyet gir")}</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Açılış Stoğu",
})

export default OpeningStockPage
