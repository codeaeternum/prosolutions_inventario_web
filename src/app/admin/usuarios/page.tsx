"use client"

import { useState, useEffect, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Loader2,
  Users,
  UserCheck,
  UserX,
  Clock,
  CheckCircle,
  XCircle,
  Store,
  ShoppingBag,
  UserPlus,
  Wrench,
  Crown,
  ShieldOff,
  CreditCard,
  DollarSign,
} from "lucide-react"
import { toast } from "sonner"
import { formatDate } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Pagination } from "@/components/ui/pagination"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface User {
  id: string
  name: string
  email: string
  phone: string | null
  telegramId: string | null
  role: "ADMIN" | "CUSTOMER" | "EMPLOYEE"
  customerType: "TECHNICIAN" | "STORE" | "NORMAL"
  status: "PENDING" | "APPROVED" | "REJECTED"
  creditLimit?: number | null
  creditBalance?: number
  createdAt: string
  _count: { reservations: number }
}

const DEFAULT_LIMIT = 20

export default function UsersPage() {
  const searchParams = useSearchParams()
  const pageFromUrl = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
  const limitFromUrl = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT))

  const [users, setUsers] = useState<User[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("all")
  const [activeTab, setActiveTab] = useState<string>("clientes")
  const [updating, setUpdating] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    password: "",
    role: "CUSTOMER",
    customerType: "NORMAL",
  })

  const fetchUsers = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (filter !== "all") params.set("status", filter.toUpperCase())
      
      if (activeTab === "empleados") {
        params.set("role", "EMPLOYEE")
      } else if (activeTab === "administradores") {
        params.set("role", "ADMIN")
      } else if (activeTab === "pendientes") {
        params.set("status", "PENDING")
      } else {
        // clientes
        params.set("role", "CUSTOMER")
      }

      params.set("page", String(pageFromUrl))
      params.set("limit", String(limitFromUrl))
      
      const res = await fetch(`/api/users?${params}`)
      const data = await res.json()
      if (data && typeof data === "object" && "users" in data) {
        setUsers(data.users ?? [])
        setTotal(data.total ?? 0)
        setTotalPages(data.totalPages ?? 1)
      } else {
        const list = Array.isArray(data) ? data : []
        setUsers(list)
        setTotal(list.length)
        setTotalPages(1)
      }
    } catch (error) {
      console.error("Error fetching users:", error)
      toast.error("No se pudieron cargar los usuarios. Reintenta en un momento.")
    } finally {
      setLoading(false)
    }
  }, [filter, pageFromUrl, limitFromUrl, activeTab])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const updateUser = async (id: string, data: { status?: string; customerType?: string; role?: string }) => {
    setUpdating(id)
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })

      const result = await res.json()

      if (res.ok) {
        fetchUsers()
        if (data.status === "APPROVED") {
          toast.success("Usuario aprobado exitosamente")
        } else if (data.status === "REJECTED") {
          toast.success("Usuario rechazado")
        } else if (data.customerType) {
          toast.success(`Tipo de cliente actualizado a ${data.customerType === "STORE" ? "Tienda" : data.customerType === "TECHNICIAN" ? "Técnico" : "Particular"}`)
        } else if (data.role === "ADMIN") {
          toast.success("Usuario promovido a Administrador 👑")
        } else if (data.role === "CUSTOMER") {
          toast.success("Rol de Administrador removido")
        }
      } else {
        toast.error(result.error || "Error al actualizar usuario")
      }
    } catch (error) {
      console.error("Error updating user:", error)
      toast.error("Error de conexión")
    } finally {
      setUpdating(null)
    }
  }

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      })

      const data = await res.json()

      if (res.ok) {
        toast.success("Usuario creado exitosamente")
        setCreateOpen(false)
        setNewUser({
          name: "",
          email: "",
          password: "",
          role: "CUSTOMER",
          customerType: "NORMAL",
        })
        fetchUsers()
      } else {
        toast.error(data.error || "Error al crear usuario")
      }
    } catch (error) {
      console.error("Error creating user:", error)
      toast.error("Error de conexión")
    } finally {
      setCreating(false)
    }
  }

  const pendingCount = users.filter((u) => u.status === "PENDING").length

  const statusColors = {
    PENDING: "warning",
    APPROVED: "success",
    REJECTED: "destructive",
  } as const

  const statusIcons = {
    PENDING: Clock,
    APPROVED: CheckCircle,
    REJECTED: XCircle,
  }

  const statusLabels = {
    PENDING: "Pendiente",
    APPROVED: "Aprobado",
    REJECTED: "Rechazado",
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Usuarios</h2>
          <p className="text-muted-foreground">
            Gestiona las cuentas de clientes y administradores
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <UserPlus className="mr-2 h-4 w-4" />
              Crear Usuario
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Crear Nuevo Usuario</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreateUser} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nombre</Label>
                <Input
                  id="name"
                  value={newUser.name}
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  placeholder="Nombre completo"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  placeholder="correo@ejemplo.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  placeholder="******"
                  required
                  minLength={6}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="role">Rol</Label>
                  <Select
                    value={newUser.role}
                    onValueChange={(value) => setNewUser({ ...newUser, role: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CUSTOMER">Cliente</SelectItem>
                      <SelectItem value="EMPLOYEE">Empleado / Moderador</SelectItem>
                      <SelectItem value="ADMIN">Administrador</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="customerType">Tipo</Label>
                  <Select
                    value={newUser.customerType}
                    onValueChange={(value) => setNewUser({ ...newUser, customerType: value })}
                  >
                    <SelectTrigger disabled={newUser.role === "ADMIN"}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NORMAL">Particular</SelectItem>
                      <SelectItem value="TECHNICIAN">Técnico</SelectItem>
                      <SelectItem value="STORE">Tienda (Mayoreo)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={creating}>
                  {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Crear Usuario
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filter Tabs */}
      <Tabs defaultValue="clientes" value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="clientes" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Clientes
          </TabsTrigger>
          <TabsTrigger value="empleados" className="flex items-center gap-2">
            <Wrench className="h-4 w-4" />
            Empleados
          </TabsTrigger>
          <TabsTrigger value="administradores" className="flex items-center gap-2">
            <Crown className="h-4 w-4" />
            Admins
          </TabsTrigger>
          <TabsTrigger value="pendientes" className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Pendientes
            {pendingCount > 0 && (
              <Badge variant="destructive" className="ml-1 px-1.5 min-w-[20px] h-5 flex items-center justify-center">
                {pendingCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value={activeTab}>
          <div className="flex gap-2 flex-wrap mb-4">
            <Button
              variant={filter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter("all")}
            >
              Todos {total > 0 ? `(${total})` : ""}
            </Button>
            {activeTab === "clientes" && (
              <>
                <Button
                  variant={filter === "approved" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilter("approved")}
                >
                  <UserCheck className="mr-2 h-4 w-4" />
                  Aprobados
                </Button>
                <Button
                  variant={filter === "rejected" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilter("rejected")}
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Rechazados
                </Button>
              </>
            )}
          </div>

      {/* Users List */}
      <div className="space-y-4">
        {users.length > 0 ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {users.map((user) => {
            const StatusIcon = statusIcons[user.status]
            return (
              <Card key={user.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        {user.name}
                        {user.role === "ADMIN" && (
                          <Badge variant="default" className="bg-amber-500 hover:bg-amber-600">
                            <Crown className="mr-1 h-3 w-3" />
                            Admin
                          </Badge>
                        )}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">{user.email}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
                        {user.telegramId && (
                          <span title="Registrado por Telegram">📱 Telegram</span>
                        )}
                        {user.phone && (
                          <span>📞 {user.phone}</span>
                        )}
                        {!user.telegramId && !user.phone && (
                          <span className="italic">Sin contacto</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={statusColors[user.status]}>
                        <StatusIcon className="mr-1 h-3 w-3" />
                        {statusLabels[user.status]}
                      </Badge>
                      <Badge variant="outline">
                        {user.customerType === "STORE" ? (
                          <>
                            <Store className="mr-1 h-3 w-3" />
                            Tienda
                          </>
                        ) : user.customerType === "TECHNICIAN" ? (
                          <>
                            <Wrench className="mr-1 h-3 w-3" />
                            Técnico
                          </>
                        ) : (
                          <>
                            <ShoppingBag className="mr-1 h-3 w-3" />
                            Particular
                          </>
                        )}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                      <p>Registrado: {formatDate(user.createdAt)}</p>
                      <p>Reservas: {user._count.reservations}</p>
                      {(user.creditLimit != null || (user.creditBalance ?? 0) > 0) && (
                        <p className="flex items-center gap-1 mt-1">
                          <CreditCard className="h-3.5 w-3.5" />
                          Crédito: ${(user.creditBalance ?? 0).toLocaleString()} deuda
                          {user.creditLimit != null && ` / $${user.creditLimit.toLocaleString()} límite`}
                        </p>
                      )}
                    </div>

                    <div className="flex gap-2">
                      {user.status === "PENDING" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateUser(user.id, { status: "REJECTED" })}
                            disabled={updating === user.id}
                          >
                            {updating === user.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <XCircle className="mr-1 h-4 w-4" />
                            )}
                            Rechazar
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => updateUser(user.id, { status: "APPROVED" })}
                            disabled={updating === user.id}
                          >
                            {updating === user.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <CheckCircle className="mr-1 h-4 w-4" />
                            )}
                            Aprobar
                          </Button>
                        </>
                      )}

                      {user.status === "APPROVED" && (
                        <>
                          {user.role !== "ADMIN" && (
                            <Select
                              value={user.customerType}
                              onValueChange={(value) =>
                                updateUser(user.id, { customerType: value })
                              }
                            >
                              <SelectTrigger className="h-9 w-[140px]" disabled={updating === user.id}>
                                <span>
                                  {user.customerType === "STORE"
                                    ? "Tienda (Mayoreo)"
                                    : user.customerType === "TECHNICIAN"
                                      ? "Técnico"
                                      : "Particular"}
                                </span>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="NORMAL">Particular</SelectItem>
                                <SelectItem value="TECHNICIAN">Técnico</SelectItem>
                                <SelectItem value="STORE">Tienda (Mayoreo)</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                          <Select
                            value={user.role}
                            onValueChange={(value) =>
                              updateUser(user.id, { role: value })
                            }
                          >
                            <SelectTrigger className="h-9 w-[140px]" disabled={updating === user.id}>
                              <span>
                                {user.role === "ADMIN"
                                  ? "Administrador"
                                  : user.role === "EMPLOYEE"
                                    ? "Empleado"
                                    : "Cliente"}
                              </span>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="CUSTOMER">Cliente</SelectItem>
                              <SelectItem value="EMPLOYEE">Empleado</SelectItem>
                              <SelectItem value="ADMIN">Administrador</SelectItem>
                            </SelectContent>
                          </Select>
                        </>
                      )}

                      {user.status === "REJECTED" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateUser(user.id, { status: "APPROVED" })}
                          disabled={updating === user.id}
                        >
                          Reactivar
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
              </div>
            <div className="pt-4 border-t">
              <Pagination
                page={pageFromUrl}
                limit={limitFromUrl}
                total={total}
                totalPages={totalPages}
                query={filter !== "all" ? { status: filter.toUpperCase() } : {}}
              />
            </div>
          </>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <Users className="h-16 w-16 mx-auto mb-4 opacity-50" />
            <p>No hay usuarios {filter !== "all" ? `${statusLabels[filter.toUpperCase() as keyof typeof statusLabels]?.toLowerCase()}s` : ""}</p>
          </div>
        )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
