import { HttpTypes } from "@medusajs/types"

/**
 * Ürün detay bölümleri. İçerik öncelikle product.metadata'dan okunur,
 * admin panelden şu anahtarlarla doldurulabilir:
 *   suitable_for, usage, ingredients, recommendation
 * Metadata boşsa profesyonel, kategoriye uygun varsayılan metin gösterilir.
 */
type Props = { product: HttpTypes.StoreProduct }

const meta = (product: HttpTypes.StoreProduct, key: string) => {
  const v = product.metadata?.[key]
  return typeof v === "string" && v.trim().length > 0 ? v : undefined
}

const Section = ({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) => (
  <div className="border-t border-neutral-200 py-8 first:border-t-0 first:pt-0">
    <h3 className="font-serif text-xl text-neutral-900">{title}</h3>
    <div className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-ui-fg-subtle">
      {children}
    </div>
  </div>
)

export default function ProductDetailsSections({ product }: Props) {
  const description =
    product.description ||
    "Profesyonel salon kalitesinde, saçınızın ihtiyacına göre özenle seçilmiş bir üründür."

  const suitableFor =
    meta(product, "suitable_for") ||
    "Saçında bakım, onarım veya profesyonel sonuç arayan; salon kalitesini evinde sürdürmek isteyen herkes için uygundur. Hassas saç derisi olanların kullanım öncesi alerji testi yapması önerilir."

  const usage =
    meta(product, "usage") ||
    "Temiz ve nemli saça uygun miktarda uygulayın, saç boyunca eşit şekilde dağıtın. Ürünün yönergesindeki bekleme süresine uyun ve ardından durulayın. En iyi sonuç için düzenli kullanın."

  const ingredients =
    meta(product, "ingredients") ||
    "Profesyonel bakım için seçilmiş aktif bileşenler içerir. Tam içerik listesi için ürün ambalajını inceleyiniz."

  const recommendation =
    meta(product, "recommendation") ||
    "Bu ürünü, saç tipinize uygun şampuan ve bakım maskesiyle birlikte bir rutin halinde kullanmanızı öneririm. Doğru kombinasyon, salon sonucunu evde de kalıcı kılar."

  return (
    <section className="content-container py-16 small:py-24">
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-12 lg:grid-cols-[1.4fr_1fr]">
        {/* Sol: bilgi bölümleri */}
        <div>
          <span className="text-[11px] uppercase tracking-[0.3em] text-neutral-400">
            Ürün Detayları
          </span>
          <div className="mt-6">
            <Section title="Ürün Açıklaması">{description}</Section>
            <Section title="Kimler İçin Uygun?">{suitableFor}</Section>
            <Section title="Kullanım Şekli">{usage}</Section>
            <Section title="İçerik">{ingredients}</Section>
          </div>
        </div>

        {/* Sağ: Sinan Koçer Tavsiyesi */}
        <aside className="lg:pt-12">
          <div className="rounded-3xl bg-neutral-950 p-8 text-neutral-200">
            <span className="text-[11px] uppercase tracking-[0.3em] text-amber-200/80">
              Sinan Koçer Tavsiyesi
            </span>
            <p className="mt-5 font-serif text-lg leading-relaxed text-white">
              “{recommendation}”
            </p>
            <p className="mt-6 text-sm text-neutral-400">— Sinan Koçer</p>
          </div>
        </aside>
      </div>
    </section>
  )
}
