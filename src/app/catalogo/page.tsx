"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Search,
  Filter,
  X,
  Package,
  SlidersHorizontal,
  ShoppingCart,
  CalendarCheck,
  User,
  LogIn,
  UserPlus,
} from "lucide-react"
import { toast } from "sonner"
import { useCart } from "@/components/cart-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Pagination } from "@/components/ui/pagination"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ThemeToggle } from "@/components/theme-toggle"
import { useCurrency } from "@/components/currency-provider"
import type { Product } from "@/types"

interface Brand {
  id: string
  name: string
  _count: { models: number }
}

interface Model {
  id: string
  name: string
  brandId: string
  brand: { name: string }
}

interface Category {
  id: string
  name: string
  _count: { products: number }
}

type ProductWithDetails = Omit<Product, "wholesalePrice" | "minStock"> & {
  wholesalePrice?: number
  minStock?: number
  description?: string | null
  models: Array<{
    model: {
      name: string
      brand: { name: string }
    }
  }>
  category: { name: string }
}

export default function CatalogoPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { formatPrice } = useCurrency()
  const { addItem, totalItems } = useCart()

  const [brands, setBrands] = useState<Brand[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<ProductWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filterError, setFilterError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const pageSize = 20

  // Filters
  const [search, setSearch] = useState("")
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  // Dialog state (must be at top level, before any return)
  const [selectedProduct, setSelectedProduct] = useState<ProductWithDetails | null>(null)
  const [detailsProduct, setDetailsProduct] = useState<ProductWithDetails | null>(null)
  const [reservationOpen, setReservationOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [quantity, setQuantity] = useState(1)

  const isLoggedIn = !!session
  const customerType = session?.user?.customerType || "NORMAL"

  // Redirect to pending only if logged in but not approved
  useEffect(() => {
    if (status === "loading") return
    if (session && session.user?.status !== "APPROVED" && session.user?.role !== "ADMIN") {
      router.push("/pending")
    }
  }, [session, status, router])

  useEffect(() => {
    const controller = new AbortController()
    const loadFilters = async () => {
      try {
        const responses = await Promise.all([
          fetch("/api/brands", { signal: controller.signal }),
          fetch("/api/categories", { signal: controller.signal }),
        ])
        if (responses.some((response) => !response.ok)) throw new Error("No se pudieron cargar los filtros")
        const [brandList, categoryList] = await Promise.all(responses.map((response) => response.json()))
        if (!Array.isArray(brandList) || !Array.isArray(categoryList)) throw new Error("Respuesta de filtros no válida")
        if (controller.signal.aborted) return
        setBrands(brandList)
        setCategories(categoryList)
        setFilterError(null)
      } catch {
        if (!controller.signal.aborted) setFilterError("No se pudieron cargar marcas y categorías.")
      }
    }
    void loadFilters()
    return () => controller.abort()
  }, [reload])

  useEffect(() => {
    if (!selectedBrand) return
    const controller = new AbortController()
    const loadModels = async () => {
      try {
        const res = await fetch(`/api/models?brandId=${encodeURIComponent(selectedBrand)}`, { signal: controller.signal })
        if (!res.ok) throw new Error("No se pudieron cargar los modelos")
        const data = await res.json()
        if (!Array.isArray(data)) throw new Error("Respuesta de modelos no válida")
        if (!controller.signal.aborted) setModels(data)
      } catch {
        if (!controller.signal.aborted) setFilterError("No se pudieron cargar los modelos de esta marca.")
      }
    }
    void loadModels()
    return () => controller.abort()
  }, [selectedBrand, reload])

  useEffect(() => {
    const controller = new AbortController()
    const loadProducts = async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const params = new URLSearchParams({ page: String(page), limit: String(pageSize) })
        if (search) params.set("search", search)
        if (selectedBrand) params.set("brandId", selectedBrand)
        if (selectedModel) params.set("modelId", selectedModel)
        if (selectedCategory) params.set("categoryId", selectedCategory)
        const res = await fetch(`/api/products?${params}`, { signal: controller.signal })
        if (!res.ok) throw new Error("No se pudo cargar el catálogo")
        const data = await res.json()
        if (!Array.isArray(data.products)) throw new Error("Respuesta de catálogo no válida")
        if (controller.signal.aborted) return
        const lastPage = Math.max(1, Number(data.totalPages) || 1)
        setProducts(data.products)
        setTotal(Number(data.total) || 0)
        setTotalPages(lastPage)
        if (page > lastPage) setPage(lastPage)
      } catch {
        if (!controller.signal.aborted) setLoadError("No se pudo cargar el catálogo. Revisa tu conexión y vuelve a intentar.")
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    const debounce = setTimeout(loadProducts, 300)
    return () => { clearTimeout(debounce); controller.abort() }
  }, [search, selectedBrand, selectedModel, selectedCategory, page, reload, session?.user?.id, session?.user?.customerType])

  const changeSearch = (value: string) => { setSearch(value); setPage(1) }
  const changeCategory = (value: string | null) => { setSelectedCategory(value); setPage(1) }
  const changeModel = (value: string | null) => { setSelectedModel(value); setPage(1) }
  const changeBrand = (value: string | null) => {
    setSelectedBrand(value)
    setSelectedModel(null)
    setModels([])
    setPage(1)
  }

  const clearFilters = () => {
    setPage(1)
    setModels([])
    setSearch("")
    setSelectedBrand(null)
    setSelectedModel(null)
    setSelectedCategory(null)
  }

  const hasActiveFilters = search || selectedBrand || selectedModel || selectedCategory

  const filterContent = (
    <div className="space-y-6">
      {/* Search */}
      <div>
        <p className="text-sm font-medium mb-2 block">Buscar</p>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Buscar productos por nombre o código"
            placeholder="Buscar por nombre o código..."
            value={search}
            onChange={(e) => changeSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Categories */}
      <div>
        <label className="text-sm font-medium mb-2 block">Categoría</label>
        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => (
            <Button type="button" size="sm"
              key={cat.id}
              aria-pressed={selectedCategory === cat.id}
              variant={selectedCategory === cat.id ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => changeCategory(selectedCategory === cat.id ? null : cat.id)}
            >
              {cat.name}
              {cat._count?.products > 0 && (
                <span className="ml-1 text-xs opacity-70">({cat._count?.products})</span>
              )}
            </Button>
          ))}
        </div>
      </div>

      {/* Brands */}
      <div>
        <label className="text-sm font-medium mb-2 block">Marca</label>
        <div className="flex flex-wrap gap-2">
          {brands.map((brand) => (
            <Button type="button" size="sm"
              key={brand.id}
              aria-pressed={selectedBrand === brand.id}
              variant={selectedBrand === brand.id ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => {
                changeBrand(selectedBrand === brand.id ? null : brand.id)
              }}
            >
              {brand.name}
            </Button>
          ))}
        </div>
      </div>

      {/* Models (only show if brand selected) */}
      {selectedBrand && models.length > 0 && (
        <div>
          <label className="text-sm font-medium mb-2 block">Modelo</label>
          <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
            {models.map((model) => (
              <Button type="button" size="sm"
                key={model.id}
                aria-pressed={selectedModel === model.id}
                variant={selectedModel === model.id ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => changeModel(selectedModel === model.id ? null : model.id)}
              >
                {model.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {hasActiveFilters && (
        <Button variant="outline" className="w-full" onClick={clearFilters}>
          <X className="mr-2 h-4 w-4" />
          Limpiar Filtros
        </Button>
      )}
    </div>
  )

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  const handleAddToCartClick = (product: ProductWithDetails) => {
    // Check if user is logged in
    if (!session) {
      toast.error("Inicia sesión para agregar productos al carrito")
      router.push("/login?callbackUrl=/catalogo")
      return
    }
    // Check if user is approved
    if (session.user?.status !== "APPROVED" && session.user?.role !== "ADMIN") {
      toast.error("Tu cuenta debe ser aprobada para hacer reservas")
      return
    }
    setSelectedProduct(product)
    setQuantity(1)
    setReservationOpen(true)
  }

  const handleConfirmAddToCart = () => {
    if (!selectedProduct) return

    const price = customerType === "STORE"
      ? (selectedProduct.wholesalePrice ?? selectedProduct.retailPrice)
      : selectedProduct.retailPrice

    addItem({
      productId: selectedProduct.id,
      name: selectedProduct.name,
      price: price,
      quantity: quantity,
      image: selectedProduct.images[0],
      maxStock: selectedProduct.stock
    })

    setReservationOpen(false)
    toast.success("Producto agregado al carrito")
  }

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      {/* Reservation Dialog */}
      <Dialog open={reservationOpen} onOpenChange={setReservationOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reservar producto</DialogTitle>
            <DialogDescription>
              {selectedProduct?.name}. Elige la cantidad y agrega al carrito para completar la reserva.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Precio Unitario:</span>
              <span className="font-bold text-primary">
                {selectedProduct && formatPrice(
                  customerType === "STORE"
                    ? (selectedProduct.wholesalePrice ?? selectedProduct.retailPrice)
                    : selectedProduct.retailPrice
                )}
              </span>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Cantidad</label>
              <div className="flex items-center gap-4">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  disabled={quantity <= 1}
                >
                  -
                </Button>
                <span className="w-12 text-center font-bold">{quantity}</span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setQuantity(Math.min(selectedProduct?.stock || 1, quantity + 1))}
                  disabled={quantity >= (selectedProduct?.stock || 1)}
                >
                  +
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-right">
                Disponibles: {selectedProduct?.stock}
              </p>
            </div>

            <div className="pt-2 border-t flex justify-between items-end">
              <span className="text-sm font-medium">Subtotal:</span>
              <span className="text-xl font-bold text-primary">
                {selectedProduct && formatPrice(
                  (customerType === "STORE"
                    ? (selectedProduct.wholesalePrice ?? selectedProduct.retailPrice)
                    : selectedProduct.retailPrice) * quantity
                )}
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReservationOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmAddToCart}>
              <ShoppingCart className="mr-2 h-4 w-4" />
              Agregar al Carrito
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Product Details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalles del Producto</DialogTitle>
          </DialogHeader>

          <div className="grid md:grid-cols-2 gap-6 pb-6">
            {/* Image */}
            <div className="aspect-square relative bg-muted rounded-lg overflow-hidden">
              {detailsProduct?.images[0] ? (
                <Image
                  src={detailsProduct.images[0]}
                  alt={detailsProduct.name}
                  fill
                  sizes="(max-width: 768px) 100vw, 400px"
                  className="object-cover"
                />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <Package className="h-16 w-16 text-muted-foreground/40" />
                </div>
              )}
            </div>

            {/* Info */}
            <div className="space-y-4">
              <div>
                <h3 className="text-xl font-bold">{detailsProduct?.name}</h3>
                <p className="text-2xl font-bold text-primary mt-2">
                  {detailsProduct && formatPrice(
                    customerType === "STORE"
                      ? (detailsProduct.wholesalePrice ?? detailsProduct.retailPrice)
                      : detailsProduct.retailPrice
                  )}
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Badge variant={detailsProduct?.stock && detailsProduct.stock > 0 ? "default" : "secondary"}>
                    {detailsProduct?.stock && detailsProduct.stock > 0 ? "Disponible" : "Agotado"}
                  </Badge>
                  <Badge variant="outline">
                    {detailsProduct?.category?.name}
                  </Badge>
                </div>
              </div>

              <div className="text-sm text-muted-foreground whitespace-pre-line">
                {detailsProduct?.description || "Sin descripción disponible."}
              </div>

              {detailsProduct?.stock && detailsProduct.stock > 0 && (
                <Button
                  className="w-full mt-4"
                  size="lg"
                  onClick={() => {
                    if (detailsProduct) {
                      setDetailsOpen(false)
                      handleAddToCartClick(detailsProduct)
                    }
                  }}
                >
                  <ShoppingCart className="mr-2 h-5 w-5" />
                  Agregar al Carrito
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Header */}
      <header className="sticky top-0 safe-area-sticky z-50 border-b bg-background">
        <div className="container mx-auto max-w-7xl flex h-14 items-center justify-between px-4 gap-2">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <Image
              src="/logo.jpg"
              alt="Pro-Solutions"
              width={32}
              height={32}
              className="rounded-lg"
            />
            <span className="font-bold hidden sm:inline">Pro-Solutions</span>
          </Link>

          {/* Search bar - desktop */}
          <div className="hidden md:flex flex-1 max-w-md mx-4">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                aria-label="Buscar productos por nombre o código"
            placeholder="Buscar por nombre o código..."
                value={search}
                onChange={(e) => changeSearch(e.target.value)}
                className="pl-9 w-full"
              />
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            <ThemeToggle />

            {/* Cart - always visible */}
            <Button variant="ghost" size="icon" asChild className="relative">
              <Link href="/carrito">
                <ShoppingCart className="h-5 w-5" />
                {totalItems > 0 && (
                  <span className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center bg-primary text-primary-foreground text-xs font-bold rounded-full">
                    {totalItems > 9 ? "9+" : totalItems}
                  </span>
                )}
              </Link>
            </Button>

            {/* Auth-dependent buttons */}
            {isLoggedIn ? (
              <>
                <Button variant="ghost" size="icon" asChild className="hidden sm:flex">
                  <Link href="/mis-reservas">
                    <CalendarCheck className="h-5 w-5" />
                  </Link>
                </Button>
                <Button variant="ghost" size="icon" asChild>
                  <Link href="/perfil">
                    <User className="h-5 w-5" />
                  </Link>
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" asChild className="hidden sm:flex">
                  <Link href="/login">
                    <LogIn className="h-4 w-4 mr-1" />
                    Ingresar
                  </Link>
                </Button>
                <Button size="sm" asChild className="hidden sm:flex">
                  <Link href="/register">
                    <UserPlus className="h-4 w-4 mr-1" />
                    Registrarse
                  </Link>
                </Button>
                {/* Mobile: just icon for login */}
                <Button variant="ghost" size="icon" asChild className="sm:hidden">
                  <Link href="/login">
                    <LogIn className="h-5 w-5" />
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main-content" className="container mx-auto max-w-7xl px-4 py-4" role="main">
        {/* Mobile search + filter button */}
        <div className="md:hidden flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="Buscar productos"
              placeholder="Buscar..."
              value={search}
              onChange={(e) => changeSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="shrink-0" aria-label="Abrir filtros">
                <SlidersHorizontal className="h-4 w-4" />
                {hasActiveFilters && (
                  <span className="absolute -top-1 -right-1 h-3 w-3 bg-primary rounded-full" />
                )}
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-[80vh]">
              <SheetHeader>
                <SheetTitle>Filtros</SheetTitle>
              </SheetHeader>
              <div className="mt-4 overflow-y-auto">
                {filterContent}
              </div>
            </SheetContent>
          </Sheet>
        </div>

        {filterError && (
          <div role="alert" className="mb-4 flex items-center gap-3 text-sm">
            <p>{filterError}</p>
            <Button variant="outline" size="sm" onClick={() => setReload((value) => value + 1)}>Reintentar filtros</Button>
          </div>
        )}

        {/* Active filters display */}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-sm text-muted-foreground">Filtros:</span>
            {selectedCategory && (
              <Badge variant="secondary" className="gap-1">
                {categories.find(c => c.id === selectedCategory)?.name}
                <X className="h-3 w-3 cursor-pointer" onClick={() => changeCategory(null)} />
              </Badge>
            )}
            {selectedBrand && (
              <Badge variant="secondary" className="gap-1">
                {brands.find(b => b.id === selectedBrand)?.name}
                <X className="h-3 w-3 cursor-pointer" onClick={() => changeBrand(null)} />
              </Badge>
            )}
            {selectedModel && (
              <Badge variant="secondary" className="gap-1">
                {models.find(m => m.id === selectedModel)?.name}
                <X className="h-3 w-3 cursor-pointer" onClick={() => changeModel(null)} />
              </Badge>
            )}
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-6 text-xs">
              Limpiar todo
            </Button>
          </div>
        )}

        <div className="flex gap-6">
          {/* Desktop sidebar filters */}
          <aside className="hidden md:block w-64 shrink-0">
            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  Filtros
                </h3>
                {filterContent}
              </CardContent>
            </Card>
          </aside>

          {/* Products grid */}
          <div className="flex-1">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted-foreground">
                {total} producto{total !== 1 ? 's' : ''}
              </p>
            </div>

            {loadError ? (
              <div role="alert" className="rounded-lg border p-6 space-y-3">
                <p>{loadError}</p>
                <Button variant="outline" onClick={() => setReload((value) => value + 1)}>Reintentar</Button>
              </div>
            ) : loading ? (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3" aria-busy="true" aria-label="Cargando productos">
                {[...Array(6)].map((_, i) => (
                  <Card key={i} className="animate-pulse overflow-hidden">
                    <div className="aspect-square bg-muted" />
                    <CardContent className="p-3">
                      <div className="h-3 bg-muted rounded w-1/2 mb-2" />
                      <div className="h-4 bg-muted rounded mb-2 min-h-[2.5rem]" />
                      <div className="h-3 bg-muted rounded w-2/3 mb-2" />
                      <div className="h-5 bg-muted rounded w-1/3 mt-2" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : products.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="h-16 w-16 mx-auto mb-4 opacity-50" />
                <p>No se encontraron productos</p>
                {hasActiveFilters && (
                  <Button variant="link" onClick={clearFilters} className="mt-2">
                    Limpiar filtros
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {products.map((product) => (
                  <Card key={product.id} className="overflow-hidden group hover:shadow-md transition-shadow relative">
                    {/* Card Content - Make clickable for details */}
                    <div
                      className="cursor-pointer"
                      onClick={() => {
                        setDetailsProduct(product)
                        setDetailsOpen(true)
                      }}
                    >
                      <div className="aspect-square relative bg-gradient-to-br from-muted to-muted/50">
                        {product.images[0] ? (
                          <Image
                            src={product.images[0]}
                            alt={product.name}
                            fill
                            sizes="(max-width: 1024px) 50vw, 33vw"
                            className="object-cover group-hover:scale-105 transition-transform"
                          />
                        ) : (
                          <div className="flex items-center justify-center h-full">
                            <Package className="h-12 w-12 text-muted-foreground/40" />
                          </div>
                        )}

                        {/* Stock badge */}
                        {product.stock > 0 && product.stock <= (product.minStock ?? 1) && (
                          <Badge variant="destructive" className="absolute top-2 right-2 text-[10px] px-1.5 z-10">
                            {product.stock} UD
                          </Badge>
                        )}
                        {product.stock === 0 && (
                          <Badge variant="secondary" className="absolute top-2 right-2 text-[10px] px-1.5 z-10">
                            Agotado
                          </Badge>
                        )}
                        {product.stock > (product.minStock ?? 1) && (
                          <Badge variant="default" className="absolute top-2 right-2 text-[10px] px-1.5 bg-green-600 z-10">
                            {product.stock} UD
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Add button - Always visible and separated from click area */}
                    {product.stock > 0 && (
                      <div className="absolute bottom-3 right-3 z-20">
                        <Button
                          size="sm"
                          className="h-9 px-3 rounded-full shadow-lg font-medium"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleAddToCartClick(product)
                          }}
                        >
                          <ShoppingCart className="h-4 w-4 mr-2" />
                          Agregar
                        </Button>
                      </div>
                    )}
                    <CardContent className="p-3 cursor-pointer" onClick={() => { setDetailsProduct(product); setDetailsOpen(true); }}>
                      <div className="text-[10px] text-muted-foreground truncate mb-0.5">
                        {product.models[0]?.model?.brand?.name} {product.models[0]?.model?.name}
                      </div>
                      <h3 className="font-medium text-sm line-clamp-2 mb-2 min-h-[2.5rem]">
                        {product.name}
                      </h3>
                      <Badge variant="outline" className="mb-2 text-[10px] px-1.5 py-0">
                        {product.category.name}
                      </Badge>
                      <div className="flex items-center justify-between">
                        <div className="text-base font-bold text-primary">
                          {formatPrice(
                            customerType === "STORE"
                              ? (product.wholesalePrice ?? product.retailPrice)
                              : product.retailPrice
                          )}
                        </div>
                        {customerType === "STORE" && (
                          <span className="text-[10px] text-cyan-600">taller</span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            {!loadError && (
              <div className="mt-6 border-t pt-4">
                <Pagination page={page} limit={pageSize} total={total} totalPages={totalPages} onPageChange={setPage} disabled={loading} />
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
