import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text } from "@medusajs/ui"
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
    <Container className="p-0">
      <div className="px-6 py-4">
        <Heading level="h1">{t("lotCosting.openingStock", "Açılış Stoğu (Maliyet Eksik)")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">{t("lotCosting.openingNote", "Maliyet lotu olmayan varyantlar. Owner maliyet girmeli; aksi halde gerçek kâr/fiyat uygulaması bloke.")}</Text>
      </div>
      <div className="px-6 pb-6">
        {forbidden ? (
          <Text size="small" className="text-ui-fg-error">{t("lotCosting.forbidden", "Yetki yok (yalnız owner/admin).")}</Text>
        ) : loading ? (
          <Text size="small">{t("common.loading", "Yükleniyor…")}</Text>
        ) : items.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">{t("lotCosting.allValued", "Tüm varyantların maliyet lotu var.")}</Text>
        ) : (
          <div className="flex flex-col gap-y-1">
            {items.map((it) => (
              <div key={it.variant_id} className="border-ui-border-base flex items-center justify-between border-b py-1 text-sm">
                <span>{it.title} — {it.variant_title ?? it.variant_id}</span>
                <span className="text-ui-fg-subtle">{t("lotCosting.stock", "Stok")}: {it.current_stock}</span>
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
