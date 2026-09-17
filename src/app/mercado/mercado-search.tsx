"use client"

import { useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { Loader2, Package, PackageSearch, Search, Store } from "lucide-react"
import { formatPrice } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

const MIN_CHARS = 2
const DEBOUNCE_MS = 300

interface DirectoryProduct {
  id: string
  name: string
  retailPrice: number
  image: string | null
  inStock: boolean
  category: string | null
  business: { name: string; slug: string }
}

// Resultado ligado al término que lo produjo: si el input cambia, el render
// deriva "cargando" sin necesidad de limpiar estado dentro del efecto.
type SearchResult =
  | { q: string; status: "done"; products: DirectoryProduct[] }
  | { q: string; status: "error" }

/**
 * Buscador en vivo del directorio global: al teclear (>= 2 caracteres) pide
 * /api/directory/products y reemplaza el grid de negocios (children, ya
 * renderizado en el servidor) por las tarjetas de producto encontradas.
 */
export function MercadoSearch({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("")
  const [result, setResult] = useState<SearchResult | null>(null)

  const q = query.trim()
  const searching = q.length >= MIN_CHARS
  const current = result && result.q === q ? result : null
  const loading = searching && current === null
  const products = current?.status === "done" ? current.products : []
  const failed = current?.status === "error"

  useEffect(() => {
    const term = query.trim()
    if (term.length < MIN_CHARS) return

    const controller = new AbortController()
    const debounce = setTimeout(async () => {
      try {
        const res = await fetch(`/api/directory/products?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(String(res.status))
        const data = await res.json()
        if (controller.signal.aborted) return
        setResult({
          q: term,
          status: "done",
          products: Array.isArray(data.products) ? data.products : [],
        })
      } catch {
        if (!controller.signal.aborted) setResult({ q: term, status: "error" })
      }
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(debounce)
      controller.abort()
    }
  }, [query])

  return (
    <>
      {/* Buscador */}
      <div className="relative mx-auto max-w-xl">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Busca refacciones: pantalla iPhone, batería, flexor…"
          aria-label="Buscar productos en todos los negocios"
          className="h-13 rounded-full pl-12 pr-4 text-base shadow-lg shadow-primary/10"
        />
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        {searching
          ? "Buscando en todos los negocios del directorio…"
          : "Escribe al menos 2 letras para buscar refacciones en todos los negocios."}
      </p>

      {searching ? (
        <section className="container mx-auto max-w-5xl px-4 pb-16 pt-8" aria-live="polite">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Buscando…
            </div>
          ) : failed ? (
            <div className="rounded-xl border border-dashed p-10 text-center">
              <p className="text-sm text-muted-foreground">
                No pudimos buscar. Revisa tu conexión e intenta de nuevo.
              </p>
            </div>
          ) : products.length === 0 ? (
            <div className="rounded-xl border border-dashed p-10 text-center space-y-3">
              <PackageSearch className="h-10 w-10 text-muted-foreground mx-auto" />
              <h2 className="font-semibold text-lg">Sin resultados</h2>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                Ningún negocio del directorio tiene “{q}” publicado. Prueba con otro término.
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-4">
                {products.length} resultado{products.length === 1 ? "" : "s"} en el directorio
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {products.map(product => (
                  <DirectoryProductCard key={product.id} product={product} />
                ))}
              </div>
            </>
          )}
        </section>
      ) : (
        children
      )}
    </>
  )
}

function DirectoryProductCard({ product }: { product: DirectoryProduct }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md">
      <Link
        href={`/${product.business.slug}/market`}
        className="relative block aspect-square bg-primary/5"
        aria-label={`Ver ${product.name} en ${product.business.name}`}
      >
        {product.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- URLs locales/remotas no registradas en remotePatterns
          <img
            src={product.image}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Package className="h-10 w-10 text-primary/40" aria-hidden />
          </div>
        )}
        <Badge
          variant={product.inStock ? "success" : "secondary"}
          className="absolute right-2 top-2"
        >
          {product.inStock ? "Disponible" : "Agotado"}
        </Badge>
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="space-y-1">
          {product.category && (
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {product.category}
            </p>
          )}
          <h3 className="text-sm font-medium leading-snug line-clamp-2">
            <Link href={`/${product.business.slug}/market`} className="hover:underline">
              {product.name}
            </Link>
          </h3>
        </div>

        <p className="mt-auto text-lg font-bold text-primary">
          {formatPrice(product.retailPrice)}
        </p>

        <Link
          href={`/${product.business.slug}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          <Store className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{product.business.name}</span>
        </Link>
      </div>
    </article>
  )
}
