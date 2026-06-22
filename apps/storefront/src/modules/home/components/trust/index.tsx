const items = [
  {
    title: "18+ Yıllık Deneyim",
    text: "Profesyonel kuaförlük tecrübesiyle seçilmiş ürünler.",
  },
  {
    title: "Orijinal Ürün Garantisi",
    text: "Tüm ürünler %100 orijinal ve yetkili tedarikten.",
  },
  {
    title: "Profesyonel Kuaför Tavsiyesi",
    text: "Saç tipinize uygun doğru ürün için uzman yönlendirmesi.",
  },
  {
    title: "Türkiye Geneli Gönderim",
    text: "Siparişiniz hızlı ve güvenli şekilde kapınızda.",
  },
]

const Check = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-5 w-5"
    aria-hidden
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

export default function Trust() {
  return (
    <section className="border-y border-ui-border-base bg-neutral-50">
      <div className="content-container py-14 small:py-20">
        <div className="grid grid-cols-1 gap-6 small:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <div key={item.title} className="flex flex-col items-start gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-900 text-amber-100">
                <Check />
              </span>
              <h3 className="font-serif text-base text-neutral-900 small:text-lg">
                {item.title}
              </h3>
              <p className="text-sm leading-relaxed text-ui-fg-subtle">
                {item.text}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
