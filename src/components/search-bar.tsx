"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Search, Loader2, Package, Smartphone, X } from "lucide-react"

interface SearchResult {
  type: "product" | "model"
  id: string
  name: string
  subtitle: string
}

export function SearchBar({ className }: { className?: string }) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

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
    const search = async () => {
      if (query.length < 2) {
        setResults([])
        return
      }

      setLoading(true)
      try {
        const res = await fetch(`/api/search/pos?q=${encodeURIComponent(query)}`)
        const data = await res.json()
        const mappedResults = (data.products || []).map((p: any) => ({
          type: "product" as const,
          id: p.id,
          name: p.name,
          subtitle: `${p.category?.name || ""} - ${p.barcode || "Sin código"}`,
        }))
        setResults(mappedResults)
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
    if (result.type === "product") {
      router.push(`/admin/productos/${result.id}`)
    } else {
      router.push(`/admin/modelos?selected=${result.id}`)
    }
    setShowResults(false)
    setQuery("")
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.length >= 2 && setShowResults(true)}
          placeholder="Buscar producto, modelo o SKU..."
          className="pl-9 pr-9"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
        {query && !loading && (
          <button
            onClick={() => {
              setQuery("")
              setResults([])
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2"
          >
            <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
          </button>
        )}
      </div>

      {showResults && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-card border rounded-lg shadow-lg z-50 max-h-80 overflow-auto">
          {results.map((result) => (
            <button
              key={`${result.type}-${result.id}`}
              onClick={() => handleSelect(result)}
              className="w-full flex items-center gap-3 p-3 hover:bg-accent text-left"
            >
              {result.type === "product" ? (
                <Package className="h-5 w-5 text-muted-foreground shrink-0" />
              ) : (
                <Smartphone className="h-5 w-5 text-muted-foreground shrink-0" />
              )}
              <div className="min-w-0">
                <p className="font-medium truncate">{result.name}</p>
                <p className="text-sm text-muted-foreground truncate">
                  {result.subtitle}
                </p>
              </div>
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
