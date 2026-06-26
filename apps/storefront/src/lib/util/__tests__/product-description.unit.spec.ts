import { normalizeProductDescription } from "../product-description"

const assertEqual = (actual: unknown, expected: unknown, message: string) => {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`)
  }
}

export const runProductDescriptionAssertions = () => {
  assertEqual(
    normalizeProductDescription("<P>Birinci satır</P><P>İkinci satır<br>Devam</P>"),
    "Birinci satır\nİkinci satır\nDevam",
    "safe product markup becomes plain text"
  )
  assertEqual(
    normalizeProductDescription("<script>alert('x')</script>Bakım"),
    "alert('x')Bakım",
    "markup is never executed"
  )
  assertEqual(
    normalizeProductDescription("  Düz metin  "),
    "Düz metin",
    "plain text is preserved"
  )
}
