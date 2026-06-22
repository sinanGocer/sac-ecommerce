"use client"

import { useState, useTransition } from "react"
import { useParams } from "next/navigation"
import { addToCart } from "@lib/data/cart"
import { HttpTypes } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

/**
 * Ürün kartı için "Sepete Ekle" butonu.
 * - Tek varyantlı ürün: doğrudan sepete ekler.
 * - Çok varyantlı ürün: seçenek gerektiği için ürün sayfasına yönlendirir.
 */
export default function AddToCartCard({
  product,
}: {
  product: HttpTypes.StoreProduct
}) {
  const countryCode = useParams().countryCode as string
  const [isPending, startTransition] = useTransition()
  const [added, setAdded] = useState(false)

  const variants = product.variants ?? []
  const singleVariant = variants.length === 1 ? variants[0] : null

  // Çok varyantlı: ürün sayfasına git
  if (!singleVariant) {
    return (
      <LocalizedClientLink
        href={`/products/${product.handle}`}
        className="block w-full rounded-full border border-neutral-300 py-2.5 text-center text-sm font-medium text-neutral-900 transition-colors hover:border-neutral-900 hover:bg-neutral-900 hover:text-white"
      >
        Seçenekleri Gör
      </LocalizedClientLink>
    )
  }

  const handleAdd = () => {
    startTransition(async () => {
      await addToCart({
        variantId: singleVariant.id,
        quantity: 1,
        countryCode,
      })
      setAdded(true)
      setTimeout(() => setAdded(false), 2000)
    })
  }

  return (
    <button
      onClick={handleAdd}
      disabled={isPending}
      className="w-full rounded-full bg-neutral-900 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-60"
    >
      {isPending ? "Ekleniyor..." : added ? "Sepete Eklendi ✓" : "Sepete Ekle"}
    </button>
  )
}
