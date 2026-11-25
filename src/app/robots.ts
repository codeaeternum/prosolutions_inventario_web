import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      // Incluye /mercado, /registro y todas las vitrinas públicas por slug.
      allow: "/",
      disallow: [
        "/admin", "/api", "/platform", "/aliado", "/carrito", "/cuenta",
        "/cotizacion", "/evidencia", "/mis-reservas", "/perfil", "/pending",
        "/login", "/uploads", "/verificar",
      ],
    },
    sitemap: "https://reficio.app/sitemap.xml",
  }
}
