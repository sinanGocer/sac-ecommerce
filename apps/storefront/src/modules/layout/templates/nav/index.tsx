import { Suspense } from "react"

import { listLocales } from "@lib/data/locales"
import { getLocale } from "@lib/data/locale-actions"
import { listRegions } from "@lib/data/regions"
import { StoreRegion } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import CartButton from "@modules/layout/components/cart-button"
import SideMenu from "@modules/layout/components/side-menu"

const navLinks = [
  { label: "Ürünler", href: "/store" },
  { label: "Saç Profilim", href: "/account" },
  { label: "Hakkımızda", href: "/about" },
]

export default async function Nav() {
  const [regions, locales, currentLocale] = await Promise.all([
    listRegions().then((regions: StoreRegion[]) => regions),
    listLocales(),
    getLocale(),
  ])

  return (
    <div className="sticky top-0 inset-x-0 z-50 group">
      <header className="relative mx-auto h-16 border-b border-ui-border-base bg-white/90 backdrop-blur duration-200">
        <nav className="content-container flex h-full w-full items-center justify-between text-small-regular text-ui-fg-subtle">
          {/* Sol: mobil menü + marka */}
          <div className="flex h-full min-w-0 flex-1 basis-0 items-center gap-x-3">
            <div className="h-full small:hidden">
              <SideMenu
                regions={regions}
                locales={locales}
                currentLocale={currentLocale}
              />
            </div>
            <LocalizedClientLink
              href="/"
              className="truncate font-serif text-sm uppercase tracking-wide text-ui-fg-base hover:text-ui-fg-subtle small:text-lg"
              data-testid="nav-store-link"
            >
              Sinan Koçer Hair Store
            </LocalizedClientLink>
          </div>

          {/* Orta: masaüstü menü linkleri */}
          <div className="hidden h-full items-center gap-x-8 small:flex">
            {navLinks.map((link) => (
              <LocalizedClientLink
                key={link.href}
                href={link.href}
                className="text-sm uppercase tracking-wide transition-colors hover:text-ui-fg-base"
              >
                {link.label}
              </LocalizedClientLink>
            ))}
          </div>

          {/* Sağ: hesabım + sepet */}
          <div className="flex h-full flex-1 basis-0 items-center justify-end gap-x-6">
            <LocalizedClientLink
              className="hidden text-sm uppercase tracking-wide hover:text-ui-fg-base small:block"
              href="/account"
              data-testid="nav-account-link"
            >
              Hesabım
            </LocalizedClientLink>
            <Suspense
              fallback={
                <LocalizedClientLink
                  className="flex gap-2 hover:text-ui-fg-base"
                  href="/cart"
                  data-testid="nav-cart-link"
                >
                  Sepet (0)
                </LocalizedClientLink>
              }
            >
              <CartButton />
            </Suspense>
          </div>
        </nav>
      </header>
    </div>
  )
}
