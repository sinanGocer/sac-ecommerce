import { convertToLocale } from "../money"

export const runMoneyAssertions = () => {
  const formatted = convertToLocale({
    amount: 1985,
    currency_code: "try",
  }).replace(/\u00a0/g, " ")

  if (formatted !== "₺1.985,00") {
    throw new Error(
      `Turkish TRY formatting: expected ₺1.985,00, received ${formatted}`
    )
  }
}
