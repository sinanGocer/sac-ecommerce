import {
  hasBlockingParserError,
  isAllowedAvedaHost,
  isAllowedHairProductUrl,
  isValidProductTitle,
  isVerifiedPriceSource,
  resolveSyncLimit,
  titleMatchesSlug,
} from "../sync-config"

describe("resolveSyncLimit", () => {
  it("dışarıdan SYNC_LIMIT=15 → 15", () => {
    expect(resolveSyncLimit("15")).toBe(15)
  })
  it("verilmemişse güvenli default (5)", () => {
    expect(resolveSyncLimit(undefined)).toBe(5)
  })
  it("özel default uygulanabilir", () => {
    expect(resolveSyncLimit(undefined, 10)).toBe(10)
  })
  it("geçersiz değer → default", () => {
    expect(resolveSyncLimit("abc")).toBe(5)
  })
  it("negatif değer → default", () => {
    expect(resolveSyncLimit("-3")).toBe(5)
  })
  it("sıfır → default", () => {
    expect(resolveSyncLimit("0")).toBe(5)
  })
  it("ondalık string → taban tam sayı (parseInt)", () => {
    expect(resolveSyncLimit("12.9")).toBe(12)
  })
})

describe("isAllowedAvedaHost", () => {
  it("ana alan adı izinli", () => {
    expect(isAllowedAvedaHost("https://www.aveda.com.tr/sitemap.xml")).toBe(true)
  })
  it("alt alan adı izinli", () => {
    expect(isAllowedAvedaHost("https://cdn.aveda.com.tr/x.jpg")).toBe(true)
  })
  it("kök alan adı izinli", () => {
    expect(isAllowedAvedaHost("https://aveda.com.tr/")).toBe(true)
  })
  it("başka domain reddedilir", () => {
    expect(isAllowedAvedaHost("https://evil.example.com/aveda.com.tr")).toBe(
      false
    )
  })
  it("benzer-görünümlü domain reddedilir (suffix tuzağı)", () => {
    expect(isAllowedAvedaHost("https://aveda.com.tr.evil.com/")).toBe(false)
  })
  it("host string'i de kabul eder", () => {
    expect(isAllowedAvedaHost("www.aveda.com.tr")).toBe(true)
  })
})

const B = "https://www.aveda.com.tr"

describe("isAllowedHairProductUrl — gerçek dry-run URL'leri", () => {
  it("saç şekillendirme ürünü kabul edilir", () => {
    expect(
      isAllowedHairProductUrl(
        `${B}/product/22901/62004/sac-sekillendirme/fon-spreyi/speed-of-light`
      )
    ).toBe(true)
  })
  it("saç bakım / şampuan kabul edilir", () => {
    expect(
      isAllowedHairProductUrl(
        `${B}/product/5311/62089/sac-bakim/sampuan/shampure-besleyici-sampuan`
      )
    ).toBe(true)
  })
  it("saç bakım / saç kremi kabul edilir", () => {
    expect(
      isAllowedHairProductUrl(`${B}/product/5293/62091/sac-bakim/sac-kremi/x`)
    ).toBe(true)
  })
  it("vücut bakım (el ve ayak kremi) reddedilir", () => {
    expect(
      isAllowedHairProductUrl(
        `${B}/product/17759/16410/vucut-bakim/el-ve-ayak-bakim/hand-relief`
      )
    ).toBe(false)
  })
  it("vücut bakım (duş jeli) reddedilir", () => {
    expect(
      isAllowedHairProductUrl(
        `${B}/product/5199/16409/vucut-bakim/vucut-temizleyici/rosemary-mint-dus-jeli`
      )
    ).toBe(false)
  })
  it("makyaj (dudak) reddedilir", () => {
    expect(
      isAllowedHairProductUrl(
        `${B}/product/5336/16543/makyaj/dudak-makyaji/lip-saver`
      )
    ).toBe(false)
  })
  it("checkout/legal segmentli URL reddedilir", () => {
    expect(
      isAllowedHairProductUrl(
        `${B}/product/18410/55219/checkout/invati-advanced-sac-kremi`
      )
    ).toBe(false)
  })
  it("/gifts/ listing URL reddedilir", () => {
    expect(isAllowedHairProductUrl(`${B}/gifts/hediye-setleri`)).toBe(false)
    expect(
      isAllowedHairProductUrl(`${B}/product/1/2/gifts/hediye-seti`)
    ).toBe(false)
  })
  it("başka domain reddedilir", () => {
    expect(
      isAllowedHairProductUrl(
        "https://evil.example.com/product/1/2/sac-bakim/sampuan/x"
      )
    ).toBe(false)
  })
  it("ürün olmayan listing URL reddedilir", () => {
    expect(isAllowedHairProductUrl(`${B}/sac-bakim/sampuan`)).toBe(false)
  })
})

describe("isValidProductTitle", () => {
  it("gerçek ürün adı kabul edilir", () => {
    expect(isValidProductTitle("Shampure Besleyici Şampuan")).toBe(true)
    expect(
      isValidProductTitle("Speed of Light Isıdan Koruyucu Saç Spreyi")
    ).toBe(true)
  })
  it("KVKK başlığı geçersiz (büyük harf, Türkçe İ dahil)", () => {
    expect(
      isValidProductTitle(
        "KİŞİSEL VERİLERİN KORUNMASI VE İŞLENMESİNE İLİŞKİN AYDINLATMA METNİ"
      )
    ).toBe(false)
  })
  it("çerez/gizlilik/kullanım koşulları geçersiz", () => {
    expect(isValidProductTitle("Çerez Politikası")).toBe(false)
    expect(isValidProductTitle("Gizlilik Politikası")).toBe(false)
    expect(isValidProductTitle("Kullanım Koşulları")).toBe(false)
  })
  it("sepet/giriş/üye ol geçersiz", () => {
    expect(isValidProductTitle("Sepet")).toBe(false)
    expect(isValidProductTitle("Giriş Yap")).toBe(false)
    expect(isValidProductTitle("Üye Ol")).toBe(false)
  })
  it("jenerik/boş geçersiz", () => {
    expect(isValidProductTitle("")).toBe(false)
    expect(isValidProductTitle("Homepage")).toBe(false)
    expect(isValidProductTitle("Aveda")).toBe(false)
    expect(isValidProductTitle(null)).toBe(false)
    expect(isValidProductTitle(undefined)).toBe(false)
  })
  it("jenerik site/SEO başlığı reddedilir", () => {
    expect(
      isValidProductTitle(
        "Profesyonel Saç ve Vücut Bakım Ürünleri & Fiyatları"
      )
    ).toBe(false)
    expect(isValidProductTitle("Saç ve Vücut Bakım Ürünleri")).toBe(false)
    expect(isValidProductTitle("Ürünler ve Fiyatları")).toBe(false)
    expect(isValidProductTitle("Aveda Türkiye")).toBe(false)
    expect(isValidProductTitle("Online Alışveriş")).toBe(false)
  })
  it("gerçek ürün adı '| Aveda' suffix'iyle de geçerli (suffix atılır)", () => {
    expect(isValidProductTitle("Speed of Light™ Saç Spreyi | Aveda")).toBe(true)
    expect(isValidProductTitle("Speed of Light™ Saç Spreyi")).toBe(true)
  })
  it("jenerik başlık '| Aveda' suffix'iyle de reddedilir", () => {
    expect(
      isValidProductTitle(
        "Profesyonel Saç ve Vücut Bakım Ürünleri & Fiyatları | Aveda"
      )
    ).toBe(false)
    expect(isValidProductTitle("Ana Sayfa | Aveda")).toBe(false)
  })
})

describe("hasBlockingParserError — review yönlendirme kuralı", () => {
  it("parser error varsa bloklu (create/update yok)", () => {
    expect(hasBlockingParserError(["title_from_document_only"])).toBe(true)
    expect(hasBlockingParserError(["price_unverified"])).toBe(true)
  })
  it("boş/yok bloklamaz", () => {
    expect(hasBlockingParserError([])).toBe(false)
    expect(hasBlockingParserError(undefined)).toBe(false)
    expect(hasBlockingParserError(null)).toBe(false)
  })
})

describe("titleMatchesSlug — document-title ek doğrulaması", () => {
  it("gerçek ürün adı slug ile eşleşir", () => {
    expect(
      titleMatchesSlug(
        "Speed of Light Saç Spreyi",
        "speed-of-light-isdan-koruyucu-sac-spreyi"
      )
    ).toBe(true)
  })
  it("jenerik site başlığı ürün slug'ı ile eşleşmez", () => {
    expect(
      titleMatchesSlug(
        "Profesyonel Saç ve Vücut Bakım Ürünleri & Fiyatları",
        "be-curly-bukle-belirginlestirici-krem"
      )
    ).toBe(false)
  })
  it("eksik girdi false", () => {
    expect(titleMatchesSlug(null, "x-y-z")).toBe(false)
    expect(titleMatchesSlug("X", null)).toBe(false)
  })
})

describe("isVerifiedPriceSource — fiyat provenance", () => {
  it("ürün bağlam kaynakları güvenilir", () => {
    expect(isVerifiedPriceSource("json-ld")).toBe(true)
    expect(isVerifiedPriceSource("json-key")).toBe(true)
    expect(isVerifiedPriceSource("data-attr")).toBe(true)
  })
  it("global TL fallback ve null güvenilmez", () => {
    expect(isVerifiedPriceSource("tl-text")).toBe(false)
    expect(isVerifiedPriceSource(null)).toBe(false)
  })
})
