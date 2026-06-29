import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Badge, Button, Container, Heading, Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

/**
 * Shopify benzeri sade operasyon şeridi: küçük marka alanı, tek bakışta durum
 * ve sessiz aksiyon hissi. Metinler i18n (tr/en) üzerinden gelir.
 */
const BrandBanner = () => {
  const { t } = useTranslation()
  return (
    <Container className="mb-4 overflow-hidden p-0">
      <div className="border-ui-border-base bg-ui-bg-base flex flex-col gap-4 border-b px-6 py-5 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-x-3">
          <div className="border-ui-border-strong bg-ui-bg-subtle shadow-elevation-card-rest flex h-12 w-12 shrink-0 items-center justify-center rounded-md border">
            <span className="txt-compact-medium-plus text-ui-fg-base">SK</span>
          </div>
          <div className="flex min-w-0 flex-col gap-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Heading level="h2">{t("brand.name", "Sinan Koçer Profesyonel")}</Heading>
              <Badge size="2xsmall" color="green">{t("brand.status", "Aktif")}</Badge>
            </div>
            <Text className="text-ui-fg-subtle max-w-[640px]" size="small">
              {t("brand.tagline", "Profesyonel saç & bakım kataloğu yönetimi")}
            </Text>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge size="2xsmall" color="grey">{t("brand.productOps", "Ürün operasyonu")}</Badge>
              <Badge size="2xsmall" color="blue">{t("brand.inventoryOps", "Stok takibi")}</Badge>
              <Badge size="2xsmall" color="purple">{t("brand.salonCatalog", "Salon kataloğu")}</Badge>
            </div>
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 md:w-auto md:min-w-[300px]">
          <div className="border-ui-border-base bg-ui-bg-subtle flex items-center justify-between rounded-md border px-3 py-2">
            <Text size="xsmall" className="text-ui-fg-subtle">
              {t("brand.workspace", "Admin çalışma alanı")}
            </Text>
            <Text size="xsmall" weight="plus">
              {t("brand.season", "Salon '26")}
            </Text>
          </div>
          <Button size="small" variant="secondary" className="w-full justify-center">
            {t("brand.adminMode", "Katalog düzenleme modu")}
          </Button>
        </div>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.list.before",
})

export default BrandBanner
