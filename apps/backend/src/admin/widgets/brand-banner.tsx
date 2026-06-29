import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

/**
 * Sade, kurumsal marka şeridi (ürün listesi üstü). Aşırı tasarım yok;
 * yalnız marka adı + kısa açıklama. Metinler i18n (tr/en) üzerinden gelir.
 */
const BrandBanner = () => {
  const { t } = useTranslation()
  return (
    <Container className="mb-4 flex items-center justify-between px-6 py-4">
      <div className="flex flex-col gap-y-1">
        <Heading level="h2">{t("brand.name", "Sinan Koçer Profesyonel")}</Heading>
        <Text className="text-ui-fg-subtle" size="small">
          {t("brand.tagline", "Profesyonel saç & bakım kataloğu yönetimi")}
        </Text>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.list.before",
})

export default BrandBanner
