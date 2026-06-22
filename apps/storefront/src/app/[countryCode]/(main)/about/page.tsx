import { Metadata } from "next"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

export const metadata: Metadata = {
  title: "Hakkımızda | Sinan Koçer Hair Store",
  description:
    "Sinan Koçer Hair Store, kuaför deneyimiyle seçilmiş profesyonel saç bakım ürünlerini sizinle buluşturur.",
}

const values = [
  {
    title: "Profesyonel Seçki",
    text: "Her ürün, salon deneyimiyle ve gerçek ihtiyaçlar düşünülerek özenle seçilir.",
  },
  {
    title: "Doğru Eşleştirme",
    text: "Saç tipinize, probleminize ve hedefinize uygun ürünleri kolayca bulun.",
  },
  {
    title: "Güvenilir Kalite",
    text: "Boyadan oksidana, şampuandan bakıma kadar yalnızca profesyonel kalite.",
  },
]

export default function AboutPage() {
  return (
    <div className="w-full">
      {/* Üst başlık */}
      <section className="relative overflow-hidden bg-neutral-950 py-24 small:py-32">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(212,175,124,0.18),_transparent_60%)]" />
        <div className="content-container relative text-center">
          <span className="text-[11px] uppercase tracking-[0.4em] text-amber-200/80">
            Hakkımızda
          </span>
          <h1 className="mx-auto mt-4 max-w-2xl font-serif text-4xl font-light leading-tight text-white small:text-5xl">
            Salon kalitesini evinize taşıyoruz
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-base font-light leading-relaxed text-neutral-300">
            Sinan Koçer Hair Store, kuaför deneyimiyle seçilmiş profesyonel saç
            bakım ürünlerini herkes için erişilebilir kılmak üzere kuruldu.
          </p>
        </div>
      </section>

      {/* Hikaye */}
      <section className="content-container py-16 small:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-serif text-2xl text-ui-fg-base small:text-3xl">
            Hikayemiz
          </h2>
          <p className="mt-6 text-base leading-relaxed text-ui-fg-subtle">
            Yıllara dayanan kuaförlük tecrübemizle, müşterilerimizin salonda
            aldığı kaliteyi evlerinde de sürdürebilmesini istedik. Her saç
            farklıdır; doğru boya, doğru oksidan oranı ve doğru bakım rutiniyle
            en iyi sonuç elde edilir. Biz de bu bilgiyi ürün seçkimize taşıdık.
          </p>
        </div>
      </section>

      {/* Değerler */}
      <section className="content-container pb-16 small:pb-24">
        <div className="grid grid-cols-1 gap-6 small:grid-cols-3">
          {values.map((v) => (
            <div
              key={v.title}
              className="rounded-2xl border border-neutral-200 bg-white p-8 transition-shadow hover:shadow-lg"
            >
              <h3 className="font-serif text-lg text-neutral-900">{v.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-ui-fg-subtle">
                {v.text}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-ui-border-base bg-neutral-50 py-16 text-center small:py-20">
        <div className="content-container">
          <h2 className="font-serif text-2xl text-ui-fg-base small:text-3xl">
            Saçınıza en uygun ürünleri keşfedin
          </h2>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 small:flex-row small:gap-4">
            <LocalizedClientLink
              href="/store"
              className="w-full rounded-full bg-neutral-900 px-9 py-3.5 text-center text-sm font-medium uppercase tracking-widest text-white transition-colors hover:bg-neutral-700 small:w-auto"
            >
              Ürünleri Keşfet
            </LocalizedClientLink>
            <LocalizedClientLink
              href="/account"
              className="w-full rounded-full border border-neutral-300 px-9 py-3.5 text-center text-sm font-medium uppercase tracking-widest text-neutral-900 transition-colors hover:border-neutral-900 small:w-auto"
            >
              Saç Profilimi Oluştur
            </LocalizedClientLink>
          </div>
        </div>
      </section>
    </div>
  )
}
