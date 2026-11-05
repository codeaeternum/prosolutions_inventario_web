"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Search, Loader2, Package, Smartphone, Wrench, X, ReceiptText, User } from "lucide-react"

interface SearchResult {
  type: "product" | "model" | "order" | "customer" | "sale"
  id: string
  name: string
  subtitle: string
  folio?: string
}

export function SearchBar({ className }: { className?: string }) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    document.addEventListener("keydown", handleGlobalKeyDown)
    return () => document.removeEventListener("keydown", handleGlobalKeyDown)
  }, [])

  useEffect(() => {
    const search = async () => {
      if (query.length < 2) {
        setResults([])
        setActiveIndex(0)
        return
      }

      setLoading(true)
      try {
        const [productsRes, ordersRes, clientesRes, salesRes] = await Promise.all([
          fetch(`/api/search/pos?q=${encodeURIComponent(query)}`).then(r => r.json()).catch(() => ({})),
          fetch(`/api/workshop?q=${encodeURIComponent(query)}&page=1`).then(r => r.json()).catch(() => ({})),
          fetch(`/api/clientes?q=${encodeURIComponent(query)}&limit=4`).then(r => r.json()).catch(() => ({})),
          fetch(`/api/sales?q=${encodeURIComponent(query)}&page=1`).then(r => r.json()).catch(() => ({})),
        ])
        const productResults: SearchResult[] = (productsRes.products || []).map((p: { id: string; name: string; barcode?: string | null; category?: { name: string } | null }) => ({
          type: "product" as const,
          id: p.id,
          name: p.name,
          subtitle: `${p.category?.name || ""} - ${p.barcode || "Sin código"}`,
        }))
        // El listado de taller ya trae `folio` con el formato del negocio
        // (order_folio_digits); el padStart local queda como respaldo.
        const orderResults: SearchResult[] = (ordersRes.orders || []).slice(0, 4).map((o: { id: string; number: number; folio?: string; customerName: string; equipmentType: string; brand?: string | null; model?: string | null }) => {
          const folio = typeof o.folio === "string" && o.folio ? o.folio : `OT-${String(o.number).padStart(6, "0")}`
          return {
            type: "order" as const,
            id: o.id,
            folio,
            name: `${folio} · ${o.customerName}`,
            subtitle: [o.equipmentType, o.brand, o.model].filter(Boolean).join(" · "),
          }
        })
        const customerResults: SearchResult[] = (clientesRes.clientes || []).slice(0, 4).map((c: { id: string; name: string; businessName?: string | null; phone?: string | null; email?: string | null }) => ({
          type: "customer" as const,
          id: c.id,
          name: c.name,
          subtitle: [c.businessName, c.phone, c.email].filter(Boolean).join(" · ") || "Cliente",
        }))
        const saleResults: SearchResult[] = (salesRes.sales || []).slice(0, 3).map((s: { id: string; number: number; total?: number | string | null; customer?: { name?: string | null } | null; items?: unknown[] }) => {
          const folio = `V-${String(s.number).padStart(6, "0")}`
          return {
            type: "sale" as const,
            id: s.id,
            folio,
            name: `${folio}${s.customer?.name ? ` · ${s.customer.name}` : ""}`,
            subtitle: `$${Number(s.total ?? 0).toFixed(2)} · ${s.items?.length ?? 0} art.`,
          }
        })
        setResults([...orderResults, ...saleResults, ...customerResults, ...productResults])
        setActiveIndex(0)
        setShowResults(true)
      } catch (error) {
        console.error("Search error:", error)
      } finally {
        setLoading(false)
      }
    }

    const debounce = setTimeout(search, 300)
    return () => clearTimeout(debounce)
  }, [query])

  const handleSelect = (result: SearchResult) => {
    if (result.type === "order") {
      router.push(`/admin/taller?orden=${encodeURIComponent(result.id)}`)
    } else if (result.type === "sale") {
      router.push(`/admin/tickets/venta/${result.id}`)
    } else if (result.type === "customer") {
      router.push(`/admin/clientes/${result.id}`)
    } else if (result.type === "product") {
      router.push(`/admin/productos/${result.id}`)
    } else {
      router.push(`/admin/productos?tab=clasificacion&sub=modelos`)
    }
    setShowResults(false)
    setQuery("")
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      if (results.length > 0) {
        e.preventDefault()
        setShowResults(true)
        setActiveIndex((prev) => (prev + 1) % results.length)
      }
    } else if (e.key === "ArrowUp") {
      if (results.length > 0) {
        e.preventDefault()
        setShowResults(true)
        setActiveIndex((prev) => (prev - 1 + results.length) % results.length)
      }
    } else if (e.key === "Enter") {
      if (showResults && results[activeIndex]) {
        e.preventDefault()
        handleSelect(results[activeIndex])
      }
    } else if (e.key === "Escape") {
      e.preventDefault()
      setShowResults(false)
      inputRef.current?.blur()
    }
  }

  const activeDescendantId =
    showResults && results[activeIndex]
      ? `search-result-${results[activeIndex].type}-${results[activeIndex].id}`
      : undefined

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          role="combobox"
          aria-expanded={showResults && results.length > 0}
          aria-controls="global-search-results"
          aria-activedescendant={activeDescendantId}
          aria-autocomplete="list"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.length >= 2 && setShowResults(true)}
          onKeyDown={handleKeyDown}
          placeholder="Buscar producto, folio OT-000001, cliente..."
          className="pl-9 pr-12"
        />
        {!query && !loading && (
          <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center">
            <kbd className="pointer-events-none hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">⌘K</kbd>
          </div>
        )}
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
        {query && !loading && (
          <button
            type="button"
            aria-label="Limpiar búsqueda"
            onClick={() => {
              setQuery("")
              setResults([])
              setActiveIndex(0)
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2"
          >
            <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
          </button>
        )}
      </div>

      {showResults && results.length > 0 && (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute top-full left-0 right-0 mt-1 bg-card border rounded-lg shadow-lg z-50 max-h-80 overflow-auto"
        >
          {results.map((result, index) => (
            <button
              key={`${result.type}-${result.id}`}
              id={`search-result-${result.type}-${result.id}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onClick={() => handleSelect(result)}
              onMouseEnter={() => setActiveIndex(index)}
              className={`w-full flex items-center gap-3 p-3 text-left transition-colors ${
                index === activeIndex ? "bg-accent" : "hover:bg-accent"
              }`}
            >
              {result.type === "order" ? (
                <Wrench className="h-5 w-5 text-muted-foreground shrink-0" />
              ) : result.type === "sale" ? (
                <ReceiptText className="h-5 w-5 text-muted-foreground shrink-0" />
              ) : result.type === "customer" ? (
                <User className="h-5 w-5 text-muted-foreground shrink-0" />
              ) : result.type === "product" ? (
                <Package className="h-5 w-5 text-muted-foreground shrink-0" />
              ) : (
                <Smartphone className="h-5 w-5 text-muted-foreground shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{result.name}</p>
                <p className="text-sm text-muted-foreground truncate">
                  {result.subtitle}
                </p>
              </div>
              <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {result.type === "order"
                  ? "Taller"
                  : result.type === "sale"
                  ? "Venta"
                  : result.type === "customer"
                  ? "Cliente"
                  : result.type === "product"
                  ? "Producto"
                  : "Modelo"}
              </span>
            </button>
          ))}
        </div>
      )}

      {showResults && query.length >= 2 && results.length === 0 && !loading && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-card border rounded-lg shadow-lg z-50 p-4 text-center text-muted-foreground">
          No se encontraron resultados
        </div>
      )}
    </div>
  )
}
