"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
import { Plus, Loader2, Pencil, Trash2, Layers } from "lucide-react"
import { toast } from "sonner"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/admin/empty-state"
import { InlineNameEditor } from "@/components/admin/inline-name-editor"

interface Brand {
  id: string
  name: string
}

interface Model {
  id: string
  name: string
  slug: string
  brandId: string
  brand: { name: string }
  _count: { products: number }
}

export function ModelsPanel({ embedded = false }: { embedded?: boolean }) {
  const [models, setModels] = useState<Model[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({ name: "", brandId: "" })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const [modelsRes, brandsRes] = await Promise.all([
        fetch("/api/models"),
        fetch("/api/brands"),
      ])
      const [modelsData, brandsData] = await Promise.all([
        modelsRes.json(),
        brandsRes.json(),
      ])
      setModels(modelsData)
      setBrands(brandsData)
    } catch {
      setError("Error al cargar datos")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(fetchData)
  }, [fetchData])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError("")

    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Error al crear modelo")
        return
      }

      setFormData({ name: "", brandId: "" })
      setShowForm(false)
      fetchData()
    } catch {
      setError("Error al guardar")
    } finally {
      setSaving(false)
    }
  }

  // Rename inline: PATCH /api/models { id, name }. `true` cierra el editor;
  // `false` lo deja abierto para corregir o cancelar (el toast ya avisó).
  const handleRename = async (id: string, name: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/models", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || "Error al renombrar el modelo")
        return false
      }
      toast.success("Modelo renombrado")
      void fetchData()
      return true
    } catch {
      toast.error("Error al renombrar el modelo")
      return false
    }
  }

  const handleDelete = async (id: string) => {
    setDeleteDialogOpen(false)
    setDeleteTargetId(null)
    try {
      const res = await fetch(`/api/models/${id}`, { method: "DELETE" })
      if (res.ok) {
        fetchData()
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Error al eliminar")
      }
    } catch {
      setError("Error al eliminar")
    }
  }

  // Group models by brand
  const modelsByBrand = models.reduce((acc, model) => {
    const brandName = model.brand.name
    if (!acc[brandName]) acc[brandName] = []
    acc[brandName].push(model)
    return acc
  }, {} as Record<string, Model[]>)

  if (loading) {
    return (
      <div className="space-y-6" role="status" aria-label="Cargando modelos">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-36" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        {!embedded && (
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Modelos</h2>
          <p className="text-muted-foreground">
            Gestiona los modelos de celulares por marca
          </p>
        </div>
        )}
        <Button onClick={() => setShowForm(!showForm)} className={embedded ? "ml-auto" : ""} disabled={brands.length === 0}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo Modelo
        </Button>
      </div>

      {error && (
        <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
          {error}
        </div>
      )}

      {brands.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground mb-4">
              Primero debes crear al menos una marca
            </p>
            <Button asChild>
              <Link href="/admin/productos?tab=clasificacion&sub=marcas">Ir a Marcas</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {showForm && brands.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Nuevo Modelo</CardTitle>
            <CardDescription>Agrega un nuevo modelo de celular</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="brandId">Marca</Label>
                <select
                  id="brandId"
                  value={formData.brandId}
                  onChange={(e) => setFormData({ ...formData, brandId: e.target.value })}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  required
                >
                  <option value="">Selecciona una marca</option>
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Nombre del modelo</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ej: iPhone 15 Pro, Galaxy S24 Ultra"
                  required
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Guardar
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {Object.entries(modelsByBrand).map(([brandName, brandModels]) => (
        <div key={brandName} className="space-y-4">
          <h3 className="text-lg font-semibold">{brandName}</h3>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {brandModels.map((model) => (
              <Card key={model.id}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  {editingId === model.id ? (
                    <InlineNameEditor
                      currentName={model.name}
                      onSave={(name) => handleRename(model.id, name)}
                      onClose={() => setEditingId(null)}
                    />
                  ) : (
                    <>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Layers className="h-4 w-4 text-muted-foreground" />
                        {model.name}
                      </CardTitle>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Renombrar ${model.name}`}
                          onClick={() => setEditingId(model.id)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Eliminar ${model.name}`}
                          onClick={() => {
                            setDeleteTargetId(model.id)
                            setDeleteDialogOpen(true)
                          }}
                          disabled={model._count.products > 0}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </>
                  )}
                </CardHeader>
                <CardContent>
                  <Badge variant="secondary">
                    {model._count.products} productos
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}

      {models.length === 0 && brands.length > 0 && !showForm && (
        <EmptyState
          icon={Layers}
          title="No hay modelos registrados"
          description="Asocia modelos a cada marca para clasificar tus productos."
          action={{
            label: "Agregar primer modelo",
            icon: Plus,
            onClick: () => setShowForm(true),
          }}
        />
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este modelo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Si el modelo tiene productos asociados no podrás eliminarlo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => deleteTargetId && void handleDelete(deleteTargetId)}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
