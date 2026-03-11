"use client"

import { useState, useEffect, use } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, ArrowLeft, Plus, X, ScanBarcode, Globe, Trash2 } from "lucide-react"
import { ImageUpload } from "@/components/image-upload"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import Link from "next/link"
import Image from "next/image"

interface Brand {
  id: string
  name: string
}

interface Model {
  id: string
  name: string
  brand: { name: string }
}

interface Category {
  id: string
  name: string
}

interface Product {
  id: string
  name: string
  description: string | null
  barcode: string | null
  retailPrice: number | null
  wholesalePrice: number | null
  stock: number
  minStock: number
  categoryId: string
  isPublic: boolean
  isUniversal: boolean
  isActive: boolean
  images: string[]
  models: Model[]
}

export default function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [error, setError] = useState("")
  const [product, setProduct] = useState<Product | null>(null)

  const [brands, setBrands] = useState<Brand[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [categories, setCategories] = useState<Category[]>([])

  const [selectedBrand, setSelectedBrand] = useState("")
  const [filteredModels, setFilteredModels] = useState<Model[]>([])
  const [selectedModels, setSelectedModels] = useState<Model[]>([])
  const [images, setImages] = useState<string[]>([])

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    barcode: "",
    retailPrice: "",
    wholesalePrice: "",
    stock: "0",
    minStock: "1",
    categoryId: "",
    isUniversal: false,
    isActive: true,
  })

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [productRes, brandsRes, modelsRes, categoriesRes] = await Promise.all([
          fetch(`/api/products/${resolvedParams.id}`),
          fetch("/api/brands"),
          fetch("/api/models"),
          fetch("/api/categories"),
        ])

        if (!productRes.ok) {
          throw new Error("Producto no encontrado")
        }

        const [productData, brandsData, modelsData, categoriesData] = await Promise.all([
          productRes.json(),
          brandsRes.json(),
          modelsRes.json(),
          categoriesRes.json(),
        ])

        setProduct(productData)
        setBrands(brandsData)
        setModels(modelsData)
        setCategories(categoriesData)
        setSelectedModels(productData.models || [])
        setImages(productData.images || [])

        setFormData({
          name: productData.name,
          description: productData.description || "",
          barcode: productData.barcode || "",
          retailPrice: productData.retailPrice?.toString() || "",
          wholesalePrice: productData.wholesalePrice?.toString() || "",
          stock: productData.stock.toString(),
          minStock: productData.minStock.toString(),
          categoryId: productData.categoryId,
          isUniversal: productData.isUniversal,
          isActive: productData.isActive,
        })
      } catch {
        setError("Error al cargar producto")
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [resolvedParams.id])

  useEffect(() => {
    if (selectedBrand) {
      setFilteredModels(models.filter((m) => m.brand.name === selectedBrand))
    } else {
      setFilteredModels([])
    }
  }, [selectedBrand, models])

  const handleAddModel = (model: Model) => {
    if (!selectedModels.find((m) => m.id === model.id)) {
      setSelectedModels([...selectedModels, model])
    }
  }

  const handleRemoveModel = (modelId: string) => {
    setSelectedModels(selectedModels.filter((m) => m.id !== modelId))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError("")

    if (!formData.isUniversal && selectedModels.length === 0) {
      setError("Selecciona al menos un modelo o marca como universal")
      setSaving(false)
      return
    }

    try {
      const res = await fetch(`/api/products/${resolvedParams.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          images,
          modelIds: selectedModels.map((m) => m.id),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Error al actualizar producto")
        return
      }

      router.push("/admin/productos")
    } catch {
      setError("Error al guardar")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleteDialogOpen(false)
    setDeleting(true)
    try {
      const res = await fetch(`/api/products/${resolvedParams.id}`, {
        method: "DELETE",
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Error al eliminar producto")
        return
      }

      router.push("/admin/productos")
    } catch {
      setError("Error al eliminar")
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (!product) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-destructive">Producto no encontrado</p>
        <Button asChild>
          <Link href="/admin/productos">Volver</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/admin/productos">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Editar Producto</h2>
            <p className="text-muted-foreground">
              Modifica la información del producto
            </p>
          </div>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setDeleteDialogOpen(true)}
          disabled={deleting}
        >
          {deleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4 mr-2" />
          )}
          Eliminar
        </Button>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este producto?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Se eliminará el producto y podrían afectarse reservas o movimientos asociados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void handleDelete()}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {error && (
        <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
          {error}
        </div>
      )}

      {/* Imágenes */}
      <Card>
        <CardHeader>
          <CardTitle>Fotografías</CardTitle>
          <CardDescription>
            Agrega hasta 5 imágenes del producto. La primera será la imagen principal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ImageUpload
            images={images}
            onChange={setImages}
            maxImages={5}
          />
        </CardContent>
      </Card>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Basic Info */}
          <Card>
            <CardHeader>
              <CardTitle>Información básica</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nombre del producto *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ej: Pantalla LCD Original"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Descripción</Label>
                <textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Descripción detallada del producto..."
                  className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="barcode">Código de barras</Label>
                <div className="flex gap-2">
                  <Input
                    id="barcode"
                    value={formData.barcode}
                    onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                    placeholder="Escanea o ingresa el código"
                  />
                  <Button type="button" variant="outline" asChild>
                    <Link href="/admin/productos/escanear">
                      <ScanBarcode className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="categoryId">Categoría *</Label>
                <select
                  id="categoryId"
                  value={formData.categoryId}
                  onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  required
                >
                  <option value="">Selecciona categoría</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
            </CardContent>
          </Card>

          {/* Pricing */}
          <Card>
            <CardHeader>
              <CardTitle>Precios y Stock</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="retailPrice">Precio Menudeo *</Label>
                  <Input
                    id="retailPrice"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.retailPrice}
                    onChange={(e) => setFormData({ ...formData, retailPrice: e.target.value })}
                    placeholder="0.00"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wholesalePrice">Precio Mayoreo *</Label>
                  <Input
                    id="wholesalePrice"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.wholesalePrice}
                    onChange={(e) => setFormData({ ...formData, wholesalePrice: e.target.value })}
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="stock">Stock actual</Label>
                  <Input
                    id="stock"
                    type="number"
                    min="0"
                    value={formData.stock}
                    onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="minStock">Stock mínimo (alerta)</Label>
                  <Input
                    id="minStock"
                    type="number"
                    min="0"
                    value={formData.minStock}
                    onChange={(e) => setFormData({ ...formData, minStock: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isActive"
                    checked={formData.isActive}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="isActive" className="cursor-pointer">
                    Producto activo (visible en catálogo)
                  </Label>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isPublic"
                    checked={formData.isActive}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="isPublic" className="cursor-pointer">
                    Producto Activo (Visible en el sistema)
                  </Label>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isUniversal"
                    checked={formData.isUniversal}
                    onChange={(e) => setFormData({ ...formData, isUniversal: e.target.checked })}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="isUniversal" className="cursor-pointer flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    Producto universal (compatible con todos los modelos)
                  </Label>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Models Selection */}
        {!formData.isUniversal && (
          <Card>
            <CardHeader>
              <CardTitle>Modelos compatibles</CardTitle>
              <CardDescription>
                Selecciona los modelos de celular con los que es compatible esta refacción
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Selected Models */}
              {selectedModels.length > 0 && (
                <div className="flex flex-wrap gap-2 p-3 bg-muted rounded-lg">
                  {selectedModels.map((model) => (
                    <Badge key={model.id} variant="secondary" className="gap-1">
                      {model.brand.name} {model.name}
                      <button
                        type="button"
                        onClick={() => handleRemoveModel(model.id)}
                        className="ml-1 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              {/* Brand Filter */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Filtrar por marca</Label>
                  <select
                    value={selectedBrand}
                    onChange={(e) => setSelectedBrand(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">Todas las marcas</option>
                    {brands.map((brand) => (
                      <option key={brand.id} value={brand.name}>
                        {brand.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label>Agregar modelo</Label>
                  <div className="flex gap-2">
                    <select
                      id="modelSelect"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      defaultValue=""
                    >
                      <option value="" disabled>
                        Selecciona modelo
                      </option>
                      {(selectedBrand ? filteredModels : models).map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.brand.name} {model.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        const select = document.getElementById("modelSelect") as HTMLSelectElement
                        const model = models.find((m) => m.id === select.value)
                        if (model) {
                          handleAddModel(model)
                          select.value = ""
                        }
                      }}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Submit */}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" asChild>
            <Link href="/admin/productos">Cancelar</Link>
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar Cambios
          </Button>
        </div>
      </form>
    </div>
  )
}
