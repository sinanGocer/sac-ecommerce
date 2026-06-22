import { Metadata } from "next"

import FeaturedProducts from "@modules/home/components/featured-products"
import Hero from "@modules/home/components/hero"
import CategoryCard from "@modules/home/components/category-card"
import Trust from "@modules/home/components/trust"
import { listCategories } from "@lib/data/categories"
import { getRegion } from "@lib/data/regions"

export const metadata: Metadata = {
  title: "Sinan Koçer Hair Store | Profesyonel Saç Bakım Ürünleri",
  description:
    "Salon kalitesinde saç boyası, oksidan, şampuan, maske ve ısı koruyucu ürünleri. Profesyonel saç bakımı için her şey tek adreste.",
}

// Ana sayfada gösterilecek kategori sırası (handle bazlı).
// Listede olmayan kategoriler en sona eklenir.
const CATEGORY_ORDER = [
  "şampuanlar",
  "saç-boyaları",
  "oksidanlar",
  "saç-maskeleri-&-bakım",
  "isı-koruyucular",
]

export default async function Home(props: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await props.params

  const region = await getRegion(countryCode)
  const categories = await listCategories()

  if (!region || !categories) {
    return null
  }

  // Üst seviye kategorileri istenen sıraya göre diz
  const topLevel = categories.filter((c) => !c.parent_category)
  const ordered = [...topLevel].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a.handle)
    const ib = CATEGORY_ORDER.indexOf(b.handle)
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
  })

  return (
    <>
      <Hero />

      {/* Kategori şeridi — premium kart grid, gerçek handle ile dinamik linkler */}
      <section className="content-container py-14 small:py-20">
        <div className="mb-10 text-center">
          <span className="text-[11px] uppercase tracking-[0.3em] text-neutral-400">
            Ürün Grupları
          </span>
          <h2 className="mt-3 font-serif text-3xl text-ui-fg-base small:text-4xl">
            Kategoriler
          </h2>
          <p className="mx-auto mt-3 max-w-md text-ui-fg-subtle">
            İhtiyacınıza uygun profesyonel ürün gruplarını keşfedin
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 small:grid-cols-3 small:gap-6 lg:grid-cols-5">
          {ordered.map((c) => (
            <CategoryCard key={c.id} category={c} />
          ))}
        </div>
      </section>

      {/* Kategori bazlı ürün rafları (TRY fiyatlı) */}
      <div className="pb-4">
        <ul className="flex flex-col">
          <FeaturedProducts categories={ordered} region={region} />
        </ul>
      </div>

      {/* Güven bölümü */}
      <Trust />
    </>
  )
}
