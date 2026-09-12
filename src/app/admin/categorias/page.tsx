"use client"

import { useState, useEffect } from "react"
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
import { Plus, Loader2, Pencil, Trash2, Tags } from "lucide-react"

interface Category {
  id: string
  name: string
  slug: string
  icon: string | null
  _count: { products: number }
}

export default function CategoriesPage() {
  return <CategoriesPanel />
}

export function CategoriesPanel({ embedded = false }: { embedded?: boolean }) {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({ name: "", icon: "" })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)

  const fetchCategories = async () => {
    try {
      const res = await fetch("/api/categories")
      const data = await res.json()
      setCategories(data)
    } catch {
      setError("Error al cargar categorías")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCategories()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError("")

    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Error al crear categoría")
        return
      }

      setFormData({ name: "", icon: "" })
      setShowForm(false)
      fetchCategories()
    } catch {
      setError("Error al guardar")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    setDeleteDialogOpen(false)
    setDeleteTargetId(null)
    try {
      const res = await fetch(`/api/categories/${id}`, { method: "DELETE" })
      if (res.ok) {
        fetchCategories()
      } else {
        setError("Error al eliminar")
      }
    } catch {
      setError("Error al eliminar")
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        {!embedded && (
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Categorías</h2>
            <p className="text-muted-foreground">
              Gestiona los tipos de refacciones
            </p>
          </div>
        )}
        <Button onClick={() => setShowForm(!showForm)} className={embedded ? "ml-auto" : ""}>
          <Plus className="mr-2 h-4 w-4" />
          Nueva Categoría
        </Button>
      </div>

      {error && (
        <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
          {error}
        </div>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Nueva Categoría</CardTitle>
            <CardDescription>Agrega un tipo de refacción</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nombre</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ej: Pantallas, Baterías, Flex"
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {categories.map((category) => (
          <Card key={category.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Tags className="h-5 w-5 text-muted-foreground" />
                {category.name}
              </CardTitle>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setDeleteTargetId(category.id)
                    setDeleteDialogOpen(true)
                  }}
                  disabled={category._count.products > 0}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Badge variant="secondary">
                {category._count.products} productos
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      {categories.length === 0 && !showForm && (
        <div className="text-center py-12 text-muted-foreground">
          <Tags className="h-16 w-16 mx-auto mb-4 opacity-50" />
          <p>No hay categorías registradas</p>
          <Button className="mt-4" onClick={() => setShowForm(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Agregar primera categoría
          </Button>
        </div>
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta categoría?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Si la categoría tiene productos asociados no podrás eliminarla.
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
