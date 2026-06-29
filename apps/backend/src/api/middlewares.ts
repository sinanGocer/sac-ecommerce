import { defineMiddlewares } from "@medusajs/framework/http"

import { catalogEditorRbacMiddleware } from "../rbac/catalog-editor"

export default defineMiddlewares({
  routes: [
    {
      matcher: "/admin*",
      middlewares: [catalogEditorRbacMiddleware],
    },
  ],
})
