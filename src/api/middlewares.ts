import { defineMiddlewares } from "@medusajs/framework/http"
import { authenticate } from "@medusajs/medusa/utils"

export default defineMiddlewares({
  routes: [
    {
      matcher: "/store/legacy-order-history/*",
      method: ["GET", "POST"],
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      matcher: "/store/customers/me/password",
      method: ["POST"],
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      matcher: "/admin/legacy-orders*",
      method: ["GET"],
      middlewares: [authenticate("user", ["session", "bearer", "api-key"])],
    },
    {
      matcher: "/admin/legacy-reorder-requests*",
      method: ["GET", "POST"],
      middlewares: [authenticate("user", ["session", "bearer", "api-key"])],
    },
    {
      matcher: "/admin/legacy-item-mapping-candidates*",
      method: ["GET", "POST"],
      middlewares: [authenticate("user", ["session", "bearer", "api-key"])],
    },
  ],
})
