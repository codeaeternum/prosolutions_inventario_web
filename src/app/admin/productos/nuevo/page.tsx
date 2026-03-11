"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Loader2, ArrowLeft, Plus, X, ScanBarcode, Globe } from "lucide-react"
import { ImageUpload } from "@/components/image-upload"
import Link from "next/link"
import { toast } from "sonner"

const selectClassName =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"

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

export default function NewProductPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const [brands, setBrands] = useState<Brand[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [categories, setCategories] = useState<Category[]>([])

  const [selectedBrand, setSelectedBrand] = useState("")
  const [filteredModels, setFilteredModels] = useState<Model[]>([])
  const [selectedModels, setSelectedModels] = useState<Model[]>([])
  const [images, setImages] = useState<string[]>([])

  const [dialogCategory, setDialogCategory] = useState(false)
  const [dialogBrand, setDialogBrand] = useState(false)
  const [dialogModel, setDialogModel] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState("")
  const [newBrandName, setNewBrandName] = useState("")
  const [newModelName, setNewModelName] = useState("")
  const [newModelBrandId, setNewModelBrandId] = useState("")
  const [adding, setAdding] = useState(false)

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

  const fetchData = async () => {
    try {
      const [brandsRes, modelsRes, categoriesRes] = await Promise.all([
        fetch("/api/brands"),
        fetch("/api/models"),
        fetch("/api/categories"),
      ])
      const [brandsData, modelsData, categoriesData] = await Promise.all([
        brandsRes.json(),
        modelsRes.json(),
        categoriesRes.json(),
      ])
      setBrands(brandsData)
      setModels(modelsData)
      setCategories(categoriesData)
    } catch {
      setError("Error al cargar datos")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  async function handleAddCategory() {
    if (!newCategoryName.trim()) {
      toast.error("Escribe el nombre de la categoría")
      return
    }
    setAdding(true)
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCategoryName.trim() }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || "Error al crear categoría")
        return
      }
      const created = await res.json()
      await fetchData()
      setFormData((prev) => ({ ...prev, categoryId: created.id }))
      setNewCategoryName("")
      setDialogCategory(false)
      toast.success("Categoría agregada")
    } catch {
      toast.error("Error de conexión")
    } finally {
      setAdding(false)
    }
  }

  async function handleAddBrand() {
    if (!newBrandName.trim()) {
      toast.error("Escribe el nombre de la marca")
      return
    }
    setAdding(true)
    try {
      const res = await fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newBrandName.trim() }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || "Error al crear marca")
        return
      }
      const created = await res.json()
      await fetchData()
      setSelectedBrand(created.name)
      setNewBrandName("")
      setDialogBrand(false)
      toast.success("Marca agregada")
    } catch {
      toast.error("Error de conexión")
    } finally {
      setAdding(false)
    }
  }

  async function handleCreateModel() {
    if (!newModelName.trim() || !newModelBrandId) {
      toast.error("Escribe el nombre y selecciona la marca")
      return
    }
    setAdding(true)
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newModelName.trim(), brandId: newModelBrandId }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || "Error al crear modelo")
        return
      }
      const created = await res.json()
      await fetchData()
      if (!selectedModels.find((m) => m.id === created.id)) {
        setSelectedModels((prev) => [...prev, created])
      }
      setNewModelName("")
      setNewModelBrandId("")
      setDialogModel(false)
      toast.success("Modelo agregado")
    } catch {
      toast.error("Error de conexión")
    } finally {
      setAdding(false)
    }
  }

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
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          images,
          modelIds: selectedModels.map((m) => m.id),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Error al crear producto")
        return
      }

      router.push("/admin/productos")
    } catch {
      setError("Error al guardar")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/productos">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Nuevo Producto</h2>
          <p className="text-muted-foreground">
            Agrega una nueva refacción al inventario
          </p>
        </div>
      </div>

      {error && (
        <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
          {error}
        </div>
      )}

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
                <div className="flex gap-2">
                  <select
                    id="categoryId"
                    value={formData.categoryId}
                    onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                    className={selectClassName}
                    required
                  >
                    <option value="">Selecciona categoría</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                  <Dialog open={dialogCategory} onOpenChange={setDialogCategory}>
                    <DialogTrigger asChild>
                      <Button type="button" variant="outline" size="icon" title="Agregar categoría">
                        <Plus className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Nueva categoría</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-2 py-2">
                        <Label htmlFor="newCategoryName">Nombre</Label>
                        <Input
                          id="newCategoryName"
                          value={newCategoryName}
                          onChange={(e) => setNewCategoryName(e.target.value)}
                          placeholder="Ej: Pantallas"
                        />
                      </div>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setDialogCategory(false)}>
                          Cancelar
                        </Button>
                        <Button type="button" onClick={handleAddCategory} disabled={adding}>
                          {adding && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          Agregar
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Images */}
          <Card>
            <CardHeader>
              <CardTitle>Fotografías</CardTitle>
              <CardDescription>
                Sube hasta 5 imágenes. La primera será la principal.
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
                  <Label htmlFor="stock">Stock inicial</Label>
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
                  <Label htmlFor="isActive" className="cursor-pointer flex items-center gap-2">
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
                  <div className="flex gap-2">
                    <select
                      value={selectedBrand}
                      onChange={(e) => setSelectedBrand(e.target.value)}
                      className={selectClassName}
                    >
                      <option value="">Todas las marcas</option>
                      {brands.map((brand) => (
                        <option key={brand.id} value={brand.name}>
                          {brand.name}
                        </option>
                      ))}
                    </select>
                    <Dialog open={dialogBrand} onOpenChange={setDialogBrand}>
                      <DialogTrigger asChild>
                        <Button type="button" variant="outline" size="icon" title="Agregar marca">
                          <Plus className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Nueva marca</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-2 py-2">
                          <Label htmlFor="newBrandName">Nombre</Label>
                          <Input
                            id="newBrandName"
                            value={newBrandName}
                            onChange={(e) => setNewBrandName(e.target.value)}
                            placeholder="Ej: Samsung"
                          />
                        </div>
                        <DialogFooter>
                          <Button type="button" variant="outline" onClick={() => setDialogBrand(false)}>
                            Cancelar
                          </Button>
                          <Button type="button" onClick={handleAddBrand} disabled={adding}>
                            {adding && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Agregar
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Agregar modelo</Label>
                  <div className="flex gap-2">
                    <select
                      id="modelSelect"
                      className={selectClassName}
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
                      title="Añadir a compatibles"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                    <Dialog open={dialogModel} onOpenChange={setDialogModel}>
                      <DialogTrigger asChild>
                        <Button type="button" variant="outline" size="sm" title="Crear nuevo modelo">
                          Nuevo
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Nuevo modelo</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-2">
                          <div className="space-y-2">
                            <Label htmlFor="newModelBrand">Marca</Label>
                            <select
                              id="newModelBrand"
                              value={newModelBrandId}
                              onChange={(e) => setNewModelBrandId(e.target.value)}
                              className={selectClassName}
                            >
                              <option value="">Selecciona marca</option>
                              {brands.map((b) => (
                                <option key={b.id} value={b.id}>
                                  {b.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="newModelName">Nombre del modelo</Label>
                            <Input
                              id="newModelName"
                              value={newModelName}
                              onChange={(e) => setNewModelName(e.target.value)}
                              placeholder="Ej: Galaxy S24"
                            />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button type="button" variant="outline" onClick={() => setDialogModel(false)}>
                            Cancelar
                          </Button>
                          <Button type="button" onClick={handleCreateModel} disabled={adding}>
                            {adding && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Agregar
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Submit */}
        <div className="flex justify-end gap-2 pb-20 pt-4">
          <Button type="button" variant="outline" asChild>
            <Link href="/admin/inventario">Cancelar</Link>
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar Producto
          </Button>
        </div>
      </form>
    </div>
  )
}
