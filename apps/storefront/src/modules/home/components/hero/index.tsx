import LocalizedClientLink from "@modules/common/components/localized-client-link"

const Hero = () => {
  return (
    <div className="relative h-[88vh] min-h-[560px] w-full overflow-hidden bg-neutral-950">
      {/* Arka plan: zarif koyu degrade + sıcak ışık */}
      <div className="absolute inset-0 bg-gradient-to-br from-neutral-900 via-neutral-950 to-black" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(212,175,124,0.22),_transparent_55%)]" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-amber-200/30 to-transparent" />

      <div className="absolute inset-0 z-10 mx-auto flex max-w-4xl flex-col items-center justify-center gap-7 px-6 text-center">
        <span className="text-[11px] uppercase tracking-[0.4em] text-amber-200/80 small:text-xs">
          Sinan Koçer Hair Store
        </span>

        <h1 className="font-serif text-4xl font-light leading-[1.1] text-white small:text-6xl">
          Profesyonel Saç Bakım Ürünleri
        </h1>

        <p className="max-w-xl text-base font-light leading-relaxed text-neutral-300 small:text-lg">
          Kuaför deneyimiyle seçilmiş, saç ihtiyacınıza göre profesyonel ürünler.
        </p>

        <div className="mt-3 flex w-full flex-col items-center gap-3 small:w-auto small:flex-row small:gap-4">
          <LocalizedClientLink
            href="/store"
            className="w-full rounded-full bg-amber-100 px-9 py-3.5 text-center text-sm font-medium uppercase tracking-widest text-neutral-900 transition-colors duration-200 hover:bg-white small:w-auto"
          >
            Ürünleri Keşfet
          </LocalizedClientLink>
          <LocalizedClientLink
            href="/account"
            className="w-full rounded-full border border-neutral-500 px-9 py-3.5 text-center text-sm font-medium uppercase tracking-widest text-neutral-100 transition-colors duration-200 hover:border-amber-200 hover:text-white small:w-auto"
          >
            Saç Profilimi Oluştur
          </LocalizedClientLink>
        </div>
      </div>
    </div>
  )
}

export default Hero
