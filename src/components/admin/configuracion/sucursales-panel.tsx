"use client"

// Listado y alta de sucursales. Vive como tab dentro de /admin/configuracion
// (antes página propia en /admin/sucursales); el CRUD sigue en /api/branches.
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Plus, Loader2, Building2, Package, Users, Wrench, Wallet } from "lucide-react"

interface Branch {
  id: string
  name: string
  isActive: boolean
  _count: { stocks: number; homeStaff: number; receivedOrders: number; sales: number }
  cashRegisters: { id: string; openedAt: string }[]
}

export function SucursalesPanel() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const fetchBranches = async () => {
    try {
      const res = await fetch("/api/branches")
      const data = await res.json()
      setBranches(data.branches ?? [])
    } catch {
      setError("Error al cargar sucursales")
    } finally {
      setLoading(false)
    }
  }

  // Microtask: setState síncrono en el effect dispararía renders en cascada
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    queueMicrotask(() => void fetchBranches())
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, operationId: crypto.randomUUID() }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Error al crear sucursal")
        return
      }
      setName("")
      setShowForm(false)
      fetchBranches()
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Sucursales</h2>
          <p className="text-sm text-muted-foreground">Locales con inventario y caja independientes</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="h-4 w-4 mr-2" />
          Nueva sucursal
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-md">{error}</div>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Nueva sucursal</CardTitle>
            <CardDescription>Cada sucursal lleva su propio stock, caja y reservas</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nombre</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Ej. Sucursal Centro"
                  required
                  minLength={2}
                  maxLength={80}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Crear sucursal
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {branches.map(branch => (
          <Card key={branch.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-xl">{branch.name}</CardTitle>
              </div>
              <Badge variant={branch.isActive ? "default" : "secondary"}>
                {branch.isActive ? "Activa" : "Inactiva"}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Package className="h-4 w-4" />
                  {branch._count.stocks} productos con stock
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Users className="h-4 w-4" />
                  {branch._count.homeStaff} empleados
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Wrench className="h-4 w-4" />
                  {branch._count.receivedOrders} órdenes recibidas
                </div>
                <div className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-muted-foreground" />
                  {branch.cashRegisters.length > 0 ? (
                    <Badge variant="outline" className="text-success border-success/40 font-normal">Caja abierta</Badge>
                  ) : (
                    <span className="text-muted-foreground">Caja cerrada</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {branches.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No hay sucursales registradas.
          </CardContent>
        </Card>
      )}
    </div>
  )
}
