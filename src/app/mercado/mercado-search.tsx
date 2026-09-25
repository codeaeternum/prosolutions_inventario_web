"use client"

import { useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import {
  CheckCircle2,
  Loader2,
  MapPin,
  Megaphone,
  Package,
  PackageSearch,
  Search,
  Store,
} from "lucide-react"
import { cn, formatPrice, normalizePhone } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const MIN_CHARS = 2
const DEBOUNCE_MS = 300

interface DirectoryProduct {
  id: string
  name: string
  retailPrice: number
  image: string | null
  inStock: boolean
  category: string | null
  /** Sucursales con la pieza — solo nombres, disponibilidad binaria. */
  branches?: string[]
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
// Estado del formulario "Solicitud de refacción" (POST /api/part-requests).
type RequestStatus = "idle" | "sending" | "done" | "error" | "limited"

export function MercadoSearch({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<string | null>(null)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [categories, setCategories] = useState<CategoriesResult>({ status: "loading" })

  // Solicitud de refacción: el visitante pide algo que nadie publicó.
  const [requestOpen, setRequestOpen] = useState(false)
  const [requestName, setRequestName] = useState("")
  const [requestDetail, setRequestDetail] = useState("")
  const [requestPhone, setRequestPhone] = useState("")
  const [requestStatus, setRequestStatus] = useState<RequestStatus>("idle")
  const [requestError, setRequestError] = useState<string | null>(null)

  const openRequestForm = (prefill: string) => {
    setRequestName(prefill)
    setRequestDetail("")
    setRequestPhone("")
    setRequestStatus("idle")
    setRequestError(null)
    setRequestOpen(true)
  }

  const submitRequest = async () => {
    const name = requestName.trim()
    const phone = normalizePhone(requestPhone)
    if (name.length < 2) {
      setRequestError("Describe qué refacción buscas.")
      setRequestStatus("error")
      return
    }
    if (phone.length < 10) {
      setRequestError("Ingresa tu WhatsApp a 10 dígitos para que te contacten.")
      setRequestStatus("error")
      return
    }

    setRequestStatus("sending")
    setRequestError(null)
    try {
      const res = await fetch("/api/part-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          detail: requestDetail.trim() || undefined,
          phone,
        }),
      })
      if (res.status === 429) {
        setRequestStatus("limited")
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setRequestError(typeof data.error === "string" ? data.error : "Revisa los datos e intenta de nuevo.")
        setRequestStatus("error")
        return
      }
      setRequestStatus("done")
    } catch {
      setRequestError("No pudimos enviar tu solicitud. Revisa tu conexión e intenta de nuevo.")
      setRequestStatus("error")
    }
  }

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
      <p className="mt-1 text-center">
        <button
          type="button"
          onClick={() => openRequestForm("")}
          className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
        >
          ¿No encuentras una refacción? Solicítala
        </button>
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
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openRequestForm(term)}
              >
                <Megaphone className="mr-2 h-4 w-4" />
                ¿No la encuentras? Pídela a los negocios
              </Button>
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

      {/* Solicitud de refacción — la ven los negocios en /admin/mercado y
          contactan por WhatsApp al interesado. */}
      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pide la refacción a los negocios</DialogTitle>
            <DialogDescription>
              Dinos qué buscas y tu WhatsApp. Los negocios del directorio la
              buscarán por ti y te contactan directo.
            </DialogDescription>
          </DialogHeader>

          {requestStatus === "done" ? (
            <div className="mt-4 flex flex-col items-center gap-3 rounded-lg border border-success/30 bg-success/5 p-6 text-center">
              <CheckCircle2 className="h-8 w-8 text-success" />
              <p className="text-sm font-medium">
                ¡Solicitud enviada! Los negocios la buscarán por ti y te
                contactan por WhatsApp.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRequestOpen(false)}
              >
                Cerrar
              </Button>
            </div>
          ) : (
            <form
              className="mt-4 space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (requestStatus !== "sending") void submitRequest()
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="part-request-name">¿Qué refacción buscas?</Label>
                <Input
                  id="part-request-name"
                  value={requestName}
                  onChange={(e) => setRequestName(e.target.value)}
                  placeholder="Ej. Pantalla para iPhone 13"
                  maxLength={120}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="part-request-detail">
                  Detalle <span className="text-muted-foreground font-normal">(opcional)</span>
                </Label>
                <Textarea
                  id="part-request-detail"
                  value={requestDetail}
                  onChange={(e) => setRequestDetail(e.target.value)}
                  placeholder="Modelo exacto, color, calidad, urgencia…"
                  maxLength={300}
                  rows={3}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="part-request-phone">Tu WhatsApp</Label>
                <Input
                  id="part-request-phone"
                  type="tel"
                  inputMode="tel"
                  value={requestPhone}
                  onChange={(e) => setRequestPhone(e.target.value)}
                  placeholder="Ej. 811 234 5678"
                  maxLength={30}
                  required
                />
              </div>

              {requestStatus === "limited" && (
                <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">
                  Enviaste varias solicitudes seguidas. Espera unos minutos e
                  intenta de nuevo.
                </p>
              )}
              {requestStatus === "error" && requestError && (
                <p role="alert" className="text-sm text-destructive">
                  {requestError}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRequestOpen(false)}
                  disabled={requestStatus === "sending"}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={requestStatus === "sending"}>
                  {requestStatus === "sending" && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Enviar solicitud
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
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

        {product.branches && product.branches.length > 0 && (
          <p className="inline-flex items-start gap-1 text-[11px] text-muted-foreground">
            <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
            <span className="line-clamp-2">En: {product.branches.join(" · ")}</span>
          </p>
        )}

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
