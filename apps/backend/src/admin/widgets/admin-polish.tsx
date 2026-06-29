import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { useEffect } from "react"

const THEME_KEY = "medusa_admin_theme"

const AdminPolish = () => {
  useEffect(() => {
    localStorage.setItem(THEME_KEY, "light")
    document.documentElement.classList.remove("dark")
    document.documentElement.classList.add("light")
    document.documentElement.style.colorScheme = "light"
  }, [])

  return null
}

export const config = defineWidgetConfig({
  zone: [
    "login.before",
    "product.list.before",
    "product.details.before",
    "order.list.before",
    "product_category.list.before",
  ],
})

export default AdminPolish
