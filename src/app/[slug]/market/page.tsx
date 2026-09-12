import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowLeft, ChevronLeft, ChevronRight, PackageSearch, Search, Store, X } from "lucide-react"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { resolveSlug } from "@/lib/public-slug"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PublicShell } from "@/components/public/public-shell"
import { PublicProductCard } from "@/components/public/product-card"

// Catálogo vivo (stock/precios cambian seguido): siempre dinámico.
export const dynamic = "force-dynamic"

const PAGE_SIZE = 24

interface PageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ q?: string; categoria?: string; pagina?: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const target = await resolveSlug(slug)
  if (!target || target.kind !== "business") {
    return { title: "Mercado", robots: { index: false, follow: false } }
  }
  return {
    title: `Mercado de refacciones — ${target.name}`,
    description: `Catálogo público de refacciones y accesorios de ${target.name}. Precios de menudeo.`,
    robots: { index: true, follow: true },
  }
}

// Helper para conservar q/categoria al cambiar de página o de categoría.
function marketHref(slug: string, opts: { q?: string; categoria?: string; pagina?: number }) {
  const params = new URLSearchParams()
  if (opts.q) params.set("q", opts.q)
  if (opts.categoria) params.set("categoria", opts.categoria)
  if (opts.pagina && opts.pagina > 1) params.set("pagina", String(opts.pagina))
  const qs = params.toString()
  return `/${slug}/market${qs ? `?${qs}` : ""}`
}

export default async function PublicMarketPage({ params, searchParams }: PageProps) {
  const [{ slug }, sp] = await Promise.all([params, searchParams])
  const target = await resolveSlug(slug)
  if (!target) notFound()
  // El mercado público es vitrina del negocio; un taller aliado compra en su
  // mercado B2B (logueado), así que se regresa a su perfil.
  if (target.kind !== "business") redirect(`/${target.slug}`)

  const q = (sp.q ?? "").trim().slice(0, 60)
  const categoria = (sp.categoria ?? "").trim().toLowerCase().slice(0, 60)
  const pagina = Math.max(1, Number.parseInt(sp.pagina ?? "1", 10) || 1)

  const where: Prisma.ProductWhereInput = {
    isActive: true,
    marketplaceVisible: true,
    ...(q && {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { barcode: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ],
    }),
    ...(categoria && { category: { slug: categoria } }),
  }

  const [products, total, categories] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (pagina - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        barcode: true,
        retailPrice: true,
        stock: true,
        images: true,
        category: { select: { name: true } },
      },
    }),
    prisma.product.count({ where }),
    prisma.category.findMany({
      where: { products: { some: { isActive: true, marketplaceVisible: true } } },
      orderBy: { name: "asc" },
      select: { slug: true, name: true },
    }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <PublicShell
      brandName={target.name}
      homeHref={`/${target.slug}`}
      headerRight={
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/${target.slug}/order-status`}>Rastrea tu reparación</Link>
        </Button>
      }
    >
      <section className="container mx-auto max-w-4xl px-4 pt-10 pb-16">
        {/* Encabezado */}
        <div className="space-y-4 mb-8">
          <Link
            href={`/${target.slug}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {target.name}
          </Link>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Store className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Mercado de refacciones</h1>
              <p className="text-sm text-muted-foreground">Precios de menudeo · pregunta por WhatsApp</p>
            </div>
          </div>
        </div>

        {/* Búsqueda (GET → ?q=) */}
        <form action={`/${target.slug}/market`} method="get" className="flex gap-2 mb-4">
          {categoria && <input type="hidden" name="categoria" value={categoria} />}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Buscar por nombre o código…"
              aria-label="Buscar productos por nombre o código"
              className="pl-9 h-11"
            />
          </div>
          <Button type="submit" size="lg" className="h-11">Buscar</Button>
        </form>

        {/* Categorías */}
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-8">
            <Button variant={categoria ? "outline" : "default"} size="sm" asChild>
              <Link href={marketHref(target.slug, { q: q || undefined })}>Todas</Link>
            </Button>
            {categories.map(cat => (
              <Button
                key={cat.slug}
                variant={categoria === cat.slug ? "default" : "outline"}
                size="sm"
                asChild
              >
                <Link href={marketHref(target.slug, { q: q || undefined, categoria: cat.slug })}>
                  {cat.name}
                </Link>
              </Button>
            ))}
            {(q || categoria) && (
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/${target.slug}/market`}>
                  <X className="h-4 w-4 mr-1" />
                  Limpiar
                </Link>
              </Button>
            )}
          </div>
        )}

        {/* Resultados */}
        {products.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center space-y-3">
            <PackageSearch className="h-10 w-10 text-muted-foreground mx-auto" />
            <h2 className="font-semibold text-lg">Sin resultados</h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              {q || categoria
                ? "No encontramos productos con esos filtros. Prueba con otra búsqueda."
                : "Aún no hay productos publicados en el mercado."}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {products.map(product => (
                <PublicProductCard
                  key={product.id}
                  product={product}
                  slug={target.slug}
                  phone={target.phone}
                />
              ))}
            </div>

            {/* Paginación simple */}
            {totalPages > 1 && (
              <nav className="flex items-center justify-center gap-3 mt-8" aria-label="Paginación del catálogo">
                <Button variant="outline" size="sm" asChild>
                  <Link
                    href={marketHref(target.slug, { q: q || undefined, categoria: categoria || undefined, pagina: pagina - 1 })}
                    aria-disabled={pagina <= 1}
                    tabIndex={pagina <= 1 ? -1 : undefined}
                    className={cn(pagina <= 1 && "pointer-events-none opacity-50")}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </Link>
                </Button>
                <span className="text-sm text-muted-foreground">
                  Página {pagina} de {totalPages}
                </span>
                <Button variant="outline" size="sm" asChild>
                  <Link
                    href={marketHref(target.slug, { q: q || undefined, categoria: categoria || undefined, pagina: pagina + 1 })}
                    aria-disabled={pagina >= totalPages}
                    tabIndex={pagina >= totalPages ? -1 : undefined}
                    className={cn(pagina >= totalPages && "pointer-events-none opacity-50")}
                  >
                    Siguiente
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </Button>
              </nav>
            )}

            <p className="text-xs text-muted-foreground text-center mt-8">
              {total} producto{total === 1 ? "" : "s"} · Precios de menudeo. ¿Tienes taller?{" "}
              <Link href={`/login?callbackUrl=${encodeURIComponent("/admin/mercado")}`} className="text-primary hover:underline">
                Pide precio de mayoreo
              </Link>
            </p>
          </>
        )}
      </section>
    </PublicShell>
  )
}
