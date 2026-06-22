import { HttpTypes } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

/**
 * Kategori handle'ına göre premium "placeholder" görsel teması.
 * Gerçek görsel eklenince bu degradeler kolayca <Image> ile değiştirilebilir.
 */
type Theme = { gradient: string; icon: React.ReactNode }

const ICON_BOTTLE = (
  <path d="M9 2h6v3l1 2v13a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V7l1-2V2Z" />
)
const ICON_DROPLET = <path d="M12 2s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z" />
const ICON_FLASK = (
  <path d="M9 2h6M10 2v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V2" />
)
const ICON_SPARKLE = (
  <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5Z" />
)
const ICON_FLAME = (
  <path d="M12 2c3 4 5 6 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5-1-9Z" />
)

const THEMES: Record<string, Theme> = {
  "şampuanlar": { gradient: "from-sky-200 via-sky-100 to-indigo-100", icon: ICON_BOTTLE },
  "saç-boyaları": { gradient: "from-rose-200 via-amber-100 to-orange-100", icon: ICON_DROPLET },
  "oksidanlar": { gradient: "from-emerald-200 via-teal-100 to-cyan-100", icon: ICON_FLASK },
  "saç-maskeleri-&-bakım": { gradient: "from-violet-200 via-fuchsia-100 to-purple-100", icon: ICON_SPARKLE },
  "isı-koruyucular": { gradient: "from-amber-200 via-orange-100 to-red-100", icon: ICON_FLAME },
}

const FALLBACK: Theme = {
  gradient: "from-neutral-200 via-neutral-100 to-neutral-50",
  icon: ICON_SPARKLE,
}

export default function CategoryCard({
  category,
}: {
  category: HttpTypes.StoreProductCategory
}) {
  const theme = THEMES[category.handle] ?? FALLBACK

  return (
    <LocalizedClientLink
      href={`/categories/${category.handle}`}
      className="group relative flex aspect-[3/4] flex-col justify-end overflow-hidden rounded-3xl border border-neutral-200 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-2xl"
    >
      {/* Placeholder görsel: degrade zemin */}
      <div
        className={`absolute inset-0 bg-gradient-to-br ${theme.gradient} transition-transform duration-500 group-hover:scale-110`}
      />

      {/* Dekoratif ikon */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="absolute -right-4 -top-4 h-40 w-40 text-white/40 transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3"
        aria-hidden
      >
        {theme.icon}
      </svg>

      {/* Gradient overlay (okunabilirlik) */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />

      {/* İçerik */}
      <div className="relative z-10 p-5">
        <h3 className="font-serif text-lg leading-snug text-white small:text-xl">
          {category.name}
        </h3>
        <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-widest text-neutral-900 transition-all duration-300 group-hover:bg-white group-hover:gap-2.5">
          Keşfet
          <span aria-hidden>→</span>
        </span>
      </div>
    </LocalizedClientLink>
  )
}
