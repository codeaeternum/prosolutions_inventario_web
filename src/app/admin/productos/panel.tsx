"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Plus,
  Loader2,
  Search,
  Package,
  ScanBarcode,
  AlertTriangle,
  Eye,
  LayoutGrid,
  Grid3X3,
  List,
  Edit,
  Download,
  Upload,
} from "lucide-react"
import { useCurrency } from "@/components/currency-provider"
import { EmptyState } from "@/components/admin/empty-state"
import { ExportButton } from "@/components/admin/export-button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Pagination } from "@/components/ui/pagination"
import { toast } from "sonner"

interface ProductModel {
  model: {
    id: string
    name: string
    brand: { name: string }
  }
}

interface Product {
  id: string
  name: string
  barcode: string | null
  retailPrice: number
  wholesalePrice: number
  stock: number
  minStock: number
  images: string[]
  isActive: boolean
  isUniversal: boolean
  models: ProductModel[]
  category: { name: string }
  stocks?: { quantity: number; branch: { id: string; name: string } }[]
}

type ViewMode = "grid-large" | "grid-small" | "list"

const DEFAULT_LIMIT = 20

export function ProductosPanel() {
  const { formatPrice } = useCurrency()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const tabParam = searchParams.get("tab")
  const search = searchParams.get("search") ?? ""
  const filter = searchParams.get("lowStock") === "true" ? "low-stock" : "all"
  const pageFromUrl = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
  const limitFromUrl = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT))

  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>("list")
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importResult, setImportResult] = useState<{ message: string; errors: string[] } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchProducts = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setLoadError(null)
    try {
      const params = new URLSearchParams()
      if (search) params.append("search", search)
      if (filter === "low-stock") params.append("lowStock", "true")
      params.set("page", String(pageFromUrl))
      params.set("limit", String(limitFromUrl))
      
      const res = await fetch(`/api/products?${params}`, { signal })
      if (!res.ok) throw new Error("No se pudieron cargar los productos")
      const data = await res.json()
      if (signal?.aborted) return
      if (data && typeof data === "object" && "products" in data) {
        setProducts(data.products ?? [])
        setTotal(data.total ?? 0)
        setTotalPages(data.totalPages ?? 1)
      } else {
        setProducts(Array.isArray(data) ? data : [])
        setTotal(Array.isArray(data) ? data.length : 0)
        setTotalPages(1)
      }
    } catch {
      if (!signal?.aborted) setLoadError("No se pudieron cargar los productos. Revisa tu conexión y vuelve a intentar.")
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [search, filter, pageFromUrl, limitFromUrl])

  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(() => fetchProducts(controller.signal))
    return () => controller.abort()
  }, [fetchProducts])

  const updateFilters = (values: { search?: string; lowStock?: boolean }) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", "1")
    if (values.search !== undefined) {
      if (values.search.trim()) params.set("search", values.search.trim())
      else params.delete("search")
    }
    if (values.lowStock !== undefined) {
      if (values.lowStock) params.set("lowStock", "true")
      else params.delete("lowStock")
    }
    router.replace(`${pathname}?${params}`, { scroll: false })
  }

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    updateFilters({ search: String(new FormData(e.currentTarget).get("search") ?? "") })
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const res = await fetch("/api/products/excel")
      if (!res.ok) throw new Error("Error al exportar")
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `productos_${new Date().toISOString().split("T")[0]}.xlsx`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      a.remove()
    } catch (error) {
      console.error("Error exporting:", error)
      toast.error("Error al exportar productos. Reintenta en un momento.")
    } finally {
      setExporting(false)
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setImporting(true)
    setImportResult(null)

    try {
      const formData = new FormData()
      formData.append("file", file)

      const res = await fetch("/api/products/excel", {
        method: "POST",
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        setImportResult({ message: data.error || "Error al importar", errors: [] })
      } else {
        setImportResult({ message: data.message, errors: data.errors || [] })
        fetchProducts()
      }
    } catch (error) {
      console.error("Error importing:", error)
      setImportResult({ message: "Error al importar archivo", errors: [] })
    } finally {
      setImporting(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

  const filteredProducts = products

  const getModelText = (product: Product) => {
    if (product.isUniversal) return "Universal"
    return product.models
      .slice(0, 2)
      .map((pm) => `${pm.model.brand.name} ${pm.model.name}`)
      .join(", ") + (product.models.length > 2 ? ` +${product.models.length - 2}` : "")
  }

  const getStockVariant = (product: Product): "destructive" | "warning" | "success" => {
    if (product.stock === 0) return "destructive"
    if (product.stock <= product.minStock) return "warning"
    return "success"
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-end gap-2">
        <ExportButton type="products" label="CSV" />
        <Button variant="outline" onClick={handleExport} disabled={exporting}>
          {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          Exportar
        </Button>
        <Button variant="outline" onClick={() => setShowImportDialog(true)}>
          <Upload className="mr-2 h-4 w-4" />
          Importar
        </Button>
        <Button variant="outline" asChild>
          <Link href="/admin/productos/escanear">
            <ScanBarcode className="mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Escanear</span>
          </Link>
        </Button>
        <Button asChild>
          <Link href="/admin/productos/nuevo">
            <Plus className="mr-2 h-4 w-4" />
            Nuevo
          </Link>
        </Button>
      </div>

      {/* Import Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importar Productos desde Excel</DialogTitle>
            <DialogDescription>
              Sube un archivo .xlsx con los productos. Los productos con ID existente se actualizarán.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleImport}
              className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
              disabled={importing}
            />

            {importing && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Importando...
              </div>
            )}

            {importResult && (
              <div className={`p-3 rounded-lg border ${importResult.errors.length > 0 ? "bg-destructive/5 border-destructive/20 text-destructive" : "bg-primary/5 border-primary/20 text-foreground"}`} role="status">
                <p className="font-medium">{importResult.message}</p>
                {importResult.errors.length > 0 && (
                  <ul className="mt-2 text-sm text-muted-foreground list-disc list-inside">
                    {importResult.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImportDialog(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Search and Filters */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <form onSubmit={handleSearch} className="flex-1 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre o código..."
                key={search}
                name="search"
                defaultValue={search}
                aria-label="Buscar productos por nombre o código"
                className="pl-9"
              />
            </div>
            <Button type="submit" variant="secondary">
              Buscar
            </Button>
          </form>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            <Button
              variant={filter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => updateFilters({ lowStock: false })}
            >
              Todos
            </Button>
            <Button
              variant={filter === "low-stock" ? "default" : "outline"}
              size="sm"
              onClick={() => updateFilters({ lowStock: true })}
            >
              <AlertTriangle className="mr-1 h-4 w-4" />
              Stock bajo
            </Button>

          </div>

          {/* View Mode Selector */}
          <div className="flex items-center gap-1 border rounded-lg p-1">
            <Button
              variant={viewMode === "grid-large" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setViewMode("grid-large")}
              title="Cuadrícula grande"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "grid-small" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setViewMode("grid-small")}
              title="Cuadrícula pequeña"
            >
              <Grid3X3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setViewMode("list")}
              title="Lista"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Products Display */}
      {loadError ? (
        <div role="alert" className="rounded-lg border p-6 space-y-3">
          <p>{loadError}</p>
          <Button variant="outline" onClick={() => void fetchProducts()}>Reintentar</Button>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredProducts.length > 0 ? (
        <>
          {/* Grid Large View */}
          {viewMode === "grid-large" && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredProducts.map((product) => (
                <Link key={product.id} href={`/admin/productos/${product.id}`}>
                  <Card className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer h-full group">
                    <div className="aspect-[4/3] relative bg-gradient-to-br from-muted to-muted/50">
                      {product.images[0] ? (
                        <Image
                          src={product.images[0]}
                          alt={product.name}
                          fill
                          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex items-center justify-center h-full">
                          <div className="text-center text-muted-foreground/40">
                            <Package className="h-12 w-12 mx-auto mb-2" />
                            <span className="text-xs">Sin imagen</span>
                          </div>
                        </div>
                      )}

                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                        <Button size="sm" variant="secondary">
                          <Edit className="h-4 w-4 mr-1" />
                          Editar
                        </Button>
                      </div>

                      {/* Status badges */}
                      <div className="absolute top-2 left-2 flex flex-col gap-1">
                        {product.isActive && (
                          <Badge variant="outline" className="bg-background/80 backdrop-blur-sm text-xs">
                            <Eye className="mr-1 h-3 w-3" />
                            Público
                          </Badge>
                        )}
                      </div>

                      {/* Stock badge */}
                      <Badge
                        variant={getStockVariant(product)}
                        className="absolute top-2 right-2"
                      >
                        {product.stock} UD
                      </Badge>
                    </div>

                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground mb-1 truncate">
                        {getModelText(product)}
                      </div>
                      <h3 className="font-medium line-clamp-2 mb-2 min-h-[2.5rem]">
                        {product.name}
                      </h3>
                      <Badge variant="outline" className="mb-3 text-xs">
                        {product.category.name}
                      </Badge>

                      <div className="flex justify-between items-end">
                        <div>
                          <p className="text-xs text-muted-foreground">Menudeo</p>
                          <p className="font-bold text-primary">
                            {formatPrice(product.retailPrice)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Mayoreo</p>
                          <p className="font-semibold text-cyan-500">
                            {formatPrice(product.wholesalePrice)}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}

          {/* Grid Small View */}
          {viewMode === "grid-small" && (
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {filteredProducts.map((product) => (
                <Link key={product.id} href={`/admin/productos/${product.id}`}>
                  <Card className="overflow-hidden hover:shadow-md transition-shadow cursor-pointer h-full group">
                    <div className="aspect-square relative bg-gradient-to-br from-muted to-muted/50">
                      {product.images[0] ? (
                        <Image
                          src={product.images[0]}
                          alt={product.name}
                          fill
                          sizes="(max-width: 640px) 50vw, (max-width: 1280px) 20vw, 16vw"
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex items-center justify-center h-full">
                          <Package className="h-8 w-8 text-muted-foreground/30" />
                        </div>
                      )}

                      {/* Stock badge */}
                      <Badge
                        variant={getStockVariant(product)}
                        className="absolute top-1 right-1 text-[10px] px-1.5 py-0"
                      >
                        {product.stock}
                      </Badge>

                      {product.isActive && (
                        <div className="absolute top-1 left-1">
                          <Eye className="h-3 w-3 text-white drop-shadow-md" />
                        </div>
                      )}
                    </div>

                    <CardContent className="p-2">
                      <h3 className="font-medium text-xs line-clamp-2 mb-1">
                        {product.name}
                      </h3>
                      <p className="font-bold text-primary text-sm">
                        {formatPrice(product.retailPrice)}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}

          {/* List View */}
          {viewMode === "list" && (
            <div className="space-y-2">
              {/* Header */}
              <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                <div className="col-span-5">Producto</div>
                <div className="col-span-2">Categoría</div>
                <div className="col-span-1 text-center">Stock</div>
                <div className="col-span-2 text-right">Menudeo</div>
                <div className="col-span-2 text-right">Mayoreo</div>
              </div>

              {filteredProducts.map((product) => (
                <Link key={product.id} href={`/admin/productos/${product.id}`}>
                  <Card className="hover:shadow-md transition-shadow cursor-pointer">
                    <CardContent className="p-0">
                      <div className="grid grid-cols-12 gap-4 items-center p-4">
                        {/* Image + Name */}
                        <div className="col-span-12 md:col-span-5 flex items-center gap-3">
                          <div className="w-12 h-12 relative bg-muted rounded-lg flex-shrink-0 overflow-hidden">
                            {product.images[0] ? (
                              <Image
                                src={product.images[0]}
                                alt={product.name}
                                fill
                                sizes="48px"
                                className="object-cover"
                              />
                            ) : (
                              <div className="flex items-center justify-center h-full">
                                <Package className="h-5 w-5 text-muted-foreground/30" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="font-medium truncate">{product.name}</h3>
                            <p className="text-xs text-muted-foreground truncate">
                              {getModelText(product)}
                            </p>
                          </div>
                          <div className="flex gap-1 md:hidden">
                            {product.isActive && (
                              <Eye className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                        </div>

                        {/* Category */}
                        <div className="col-span-6 md:col-span-2">
                          <Badge variant="outline" className="text-xs">
                            {product.category.name}
                          </Badge>
                        </div>

                        {/* Stock */}
                        <div className="col-span-6 md:col-span-1 text-right md:text-center">
                          <Badge variant={getStockVariant(product)}>
                            {product.stock}
                          </Badge>
                          {product.stocks && product.stocks.length > 1 && (
                            <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                              {product.stocks.map(s => `${s.branch.name}: ${s.quantity}`).join(" · ")}
                            </p>
                          )}
                        </div>

                        {/* Prices */}
                        <div className="col-span-6 md:col-span-2 text-left md:text-right">
                          <span className="text-xs text-muted-foreground md:hidden">Menudeo: </span>
                          <span className="font-bold text-primary">
                            {formatPrice(product.retailPrice)}
                          </span>
                        </div>
                        <div className="col-span-6 md:col-span-2 text-right">
                          <span className="text-xs text-muted-foreground md:hidden">Mayoreo: </span>
                          <span className="font-semibold text-cyan-500">
                            {formatPrice(product.wholesalePrice)}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}

        </>
      ) : (
        <EmptyState 
          icon={Package} 
          title="No se encontraron productos" 
          description={search || filter !== "all" ? "Prueba con otros filtros o vuelve a la primera página." : "Agrega tu primer producto al inventario."} 
          action={search || filter !== "all" ? undefined : { label: "Agregar primer producto", href: "/admin/productos/nuevo", icon: Plus }} 
        />
      )}
      {!loading && !loadError && (
          <div className="pt-4 border-t">
            <Pagination
              page={pageFromUrl}
              limit={limitFromUrl}
              total={total}
              totalPages={totalPages}
              query={{
                ...(tabParam && { tab: tabParam }),
                ...(search && { search }),
                ...(filter === "low-stock" && { lowStock: "true" }),
              }}
            />
          </div>
      )}
    </div>
  )
}
