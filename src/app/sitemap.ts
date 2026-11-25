import type { MetadataRoute } from "next"

export const revalidate = 300

const origin = "https://reficio.app"

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const routes: MetadataRoute.Sitemap = [
    { url: `${origin}/` },
    { url: `${origin}/mercado` },
    { url: `${origin}/registro` },
  ]

  try {
    // También cubre fallos al inicializar Prisma (p. ej. DATABASE_URL ausente).
    const { listDirectoryBusinesses } = await import("@/lib/directory")
    const businesses = await listDirectoryBusinesses()
    for (const { slug } of businesses) {
      for (const suffix of ["", "/market", "/servicios", "/order-status"]) {
        routes.push({ url: `${origin}/${slug}${suffix}` })
      }
    }
  } catch {
    // Una caída de BD no debe ocultar las rutas públicas estáticas.
    console.warn("[sitemap] Directorio no disponible; se publican las rutas estáticas.")
  }

  return routes
}
