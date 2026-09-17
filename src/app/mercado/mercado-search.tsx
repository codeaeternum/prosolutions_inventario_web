"use client"

import { useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { Loader2, Package, PackageSearch, Search, Store } from "lucide-react"
import { cn, formatPrice } from "@/lib/utils"
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

interface DirectoryCategory {
  name: string
  count: number
}

// Resultado ligado a los parámetros que lo produjeron (texto + categoría):
// si cambian, el render deriva "cargando" sin limpiar estado en el efecto.
type SearchResult =
  | { key: string; status: "done"; products: DirectoryProduct[] }
  | { key: string; status: "error" }

type CategoriesResult =
  | { status: "loading" | "error" }
  | { status: "done"; categories: DirectoryCategory[] }

/**
 * Buscador en vivo del directorio global. Dos formas de explorar:
 * - Texto (>= 2 caracteres): /api/directory/products?q=
 * - Chips de categoría: browse con ?cat=, sola o combinada con el texto.
 * Sin ninguno se muestra el grid de negocios (children, render del servidor).
 */
export function MercadoSearch({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<string | null>(null)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [categories, setCategories] = useState<CategoriesResult>({ status: "loading" })

  const q = query.trim()
  // El texto solo participa a partir de MIN_CHARS; la categoría basta sola.
  const term = q.length >= MIN_CHARS ? q : ""
  const browsing = category !== null || term.length > 0
  const resultKey = JSON.stringify([term, category])
  const current = result && result.key === resultKey ? result : null
  const loading = browsing && current === null
  const products = current?.status === "done" ? current.products : []
  const failed = current?.status === "error"

  // Categorías reales del directorio (una sola vez): alimentan los chips.
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const res = await fetch("/api/directory/categories", {
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(String(res.status))
        const data = await res.json()
        if (controller.signal.aborted) return
        setCategories({
          status: "done",
          categories: Array.isArray(data.categories) ? data.categories : [],
        })
      } catch {
        if (!controller.signal.aborted) setCategories({ status: "error" })
      }
    })()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const term = query.trim()
    const effectiveTerm = term.length >= MIN_CHARS ? term : ""
    if (category === null && effectiveTerm.length < MIN_CHARS) return

    const key = JSON.stringify([effectiveTerm, category])
    const params = new URLSearchParams()
    if (effectiveTerm) params.set("q", effectiveTerm)
    if (category) params.set("cat", category)

    const controller = new AbortController()
    const debounce = setTimeout(async () => {
      try {
        const res = await fetch(`/api/directory/products?${params.toString()}`, {
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(String(res.status))
        const data = await res.json()
        if (controller.signal.aborted) return
        setResult({
          key,
          status: "done",
          products: Array.isArray(data.products) ? data.products : [],
        })
      } catch {
        if (!controller.signal.aborted) setResult({ key, status: "error" })
      }
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(debounce)
      controller.abort()
    }
  }, [query, category])

  const plural = (n: number, singular: string, pluralWord: string) =>
    `${n} ${n === 1 ? singular : pluralWord}`

  const resultsTitle = category
    ? term
      ? `Resultados para “${term}” en ${category} · ${plural(products.length, "producto", "productos")}`
      : `${category} en el directorio · ${plural(products.length, "producto", "productos")}`
    : `${plural(products.length, "resultado", "resultados")} en el directorio`

  const emptyMessage = category
    ? term
      ? `Ningún negocio del directorio tiene “${term}” en ${category}. Prueba con otro término o quita el filtro.`
      : `Ningún negocio del directorio tiene productos publicados en ${category} por ahora.`
    : `Ningún negocio del directorio tiene “${term}” publicado. Prueba con otro término.`

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
        {category
          ? term
            ? `Filtrando “${category}” con tu búsqueda en todos los negocios.`
            : `Explorando “${category}”. Escribe para buscar dentro de la categoría.`
          : q.length >= MIN_CHARS
            ? "Buscando en todos los negocios del directorio…"
            : "Escribe al menos 2 letras o elige una categoría para explorar."}
      </p>

      {/* Filtro por tipo de producto — si falla la carga se oculta la fila y
          el buscador sigue funcionando normal. */}
      {categories.status === "loading" ? (
        <div
          className="mx-auto mt-5 flex max-w-3xl justify-center gap-2"
          aria-hidden
        >
          {[64, 96, 80, 112, 72].map((width, i) => (
            <div
              key={i}
              className="h-7 animate-pulse rounded-full bg-muted"
              style={{ width }}
            />
          ))}
        </div>
      ) : categories.status === "done" && categories.categories.length > 0 ? (
        <div className="mx-auto mt-5 max-w-3xl">
          <p className="mb-2 text-center text-xs font-medium text-muted-foreground">
            ¿Qué buscas?
          </p>
          <div
            role="group"
            aria-label="Filtrar por tipo de producto"
            className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 sm:flex-wrap sm:justify-center"
          >
            <button
              type="button"
              onClick={() => setCategory(null)}
              aria-pressed={category === null}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                category === null
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              Todo
            </button>
            {categories.categories.map(cat => {
              const selected = category === cat.name
              return (
                <button
                  key={cat.name}
                  type="button"
                  onClick={() => setCategory(selected ? null : cat.name)}
                  aria-pressed={selected}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-muted",
                  )}
                >
                  {cat.name}{" "}
                  <span className={selected ? "text-primary-foreground/70" : "text-muted-foreground/70"}>
                    ({cat.count})
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {browsing ? (
        <section className="container mx-auto max-w-5xl px-4 pb-16 pt-8" aria-live="polite">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              {category && !term ? "Cargando productos…" : "Buscando…"}
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
                {emptyMessage}
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-4">{resultsTitle}</p>
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
