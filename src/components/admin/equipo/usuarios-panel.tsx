"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Loader2,
  Users,
  UserCheck,
  Clock,
  CheckCircle,
  XCircle,
  Store,
  ShoppingBag,
  UserPlus,
  Wrench,
  Crown,
  CreditCard,
  DollarSign,
  Send,
  Phone,
  Pencil,
  ExternalLink,
  History,
} from "lucide-react"
import { toast } from "sonner"
import { formatDate } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
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
import { SlugField, normalizeSlugInput, slugFieldError } from "@/components/admin/slug-input"
import { MODULE_LABELS, type ModuleKey } from "@/lib/access"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface User {
  id: string
  name: string
  email: string
  phone: string | null
  telegramId: string | null
  jobTitle?: string | null
  publicSlug?: string | null
  role: "ADMIN" | "CUSTOMER" | "EMPLOYEE" | "WORKSHOP"
  customerType: "TECHNICIAN" | "STORE" | "NORMAL"
  status: "PENDING" | "APPROVED" | "REJECTED"
  creditLimit?: number | null
  creditBalance?: number
  homeBranchId?: string | null
  homeBranch?: { id: string; name: string } | null
  allowedModules?: string[] | null
  allowedBranchIds?: string[] | null
  createdAt: string
  _count: { reservations: number }
}

interface Branch {
  id: string
  name: string
  isActive: boolean
}

const DEFAULT_LIMIT = 20

export function UsuariosPanel() {
  const searchParams = useSearchParams()
  const pageFromUrl = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
  const limitFromUrl = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT))

  const [users, setUsers] = useState<User[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("all")
  // ?filter=pending (link "Revisar" del dashboard) aterriza directo en Pendientes.
  const [activeTab, setActiveTab] = useState<string>(() =>
    searchParams.get("filter") === "pending" ? "pendientes" : "clientes"
  )
  const [updating, setUpdating] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    password: "",
    role: "CUSTOMER",
    customerType: "NORMAL",
    homeBranchId: "",
    jobTitle: "",
    quickPin: "",
    publicSlug: "",
    allowedModules: [] as string[],
    allowedBranchIds: [] as string[],
  })
  const [branches, setBranches] = useState<Branch[]>([])

  // Staff edit dialog (puesto + PIN rápido)
  const [editOpen, setEditOpen] = useState(false)
  const [editUser, setEditUser] = useState<User | null>(null)
  const [editJobTitle, setEditJobTitle] = useState("")
  const [editPublicSlug, setEditPublicSlug] = useState("")
  const [editPin, setEditPin] = useState("")
  const [editPinClear, setEditPinClear] = useState(false)
  const [editModules, setEditModules] = useState<string[]>([])
  const [editBranchesAllowed, setEditBranchesAllowed] = useState<string[]>([])
  const [editSaving, setEditSaving] = useState(false)

  // Lista vacía = acceso a todos los módulos / todas las sucursales.
  const toggleInList = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value]

  // Credit management dialog
  const [creditOpen, setCreditOpen] = useState(false)
  const [creditUser, setCreditUser] = useState<User | null>(null)
  const [creditLimitValue, setCreditLimitValue] = useState("")
  const [creditSaving, setCreditSaving] = useState(false)
  const [abonoAmount, setAbonoAmount] = useState("")
  const [abonoNotes, setAbonoNotes] = useState("")
  const [abonoSaving, setAbonoSaving] = useState(false)
  const [abonoPaymentMethod, setAbonoPaymentMethod] = useState<"EFECTIVO" | "TARJETA" | "TRANSFERENCIA">("EFECTIVO")
  // Sucursal donde entra el efectivo del abono; "AUTO" = sucursal base del cobrador.
  const [abonoBranch, setAbonoBranch] = useState("AUTO")
  const abonoOperation = useRef<ClientOperationKey | null>(null)
  const abonoInFlight = useRef(false)

  const fetchUsers = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (filter !== "all") params.set("status", filter.toUpperCase())

      if (activeTab === "empleados") {
        params.set("role", "EMPLOYEE")
      } else if (activeTab === "talleres") {
        params.set("role", "WORKSHOP")
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

  // Microtask: setState síncrono en el effect dispararía renders en cascada
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    queueMicrotask(() => void fetchUsers())
  }, [fetchUsers])

  useEffect(() => {
    fetch("/api/branches")
      .then(res => res.ok ? res.json() : null)
      .then(data => setBranches(data?.branches ?? []))
      .catch(() => setBranches([]))
  }, [])

  const updateUser = async (id: string, data: { status?: string; customerType?: string; role?: string; homeBranchId?: string }) => {
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
        } else if (data.role === "WORKSHOP") {
          toast.success("Usuario marcado como Taller aliado")
        } else if (data.role === "CUSTOMER") {
          toast.success("Rol de Administrador removido")
        } else if (data.homeBranchId !== undefined) {
          toast.success("Sucursal asignada")
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

    if (newUser.quickPin && !/^\d{4,6}$/.test(newUser.quickPin)) {
      toast.error("El PIN rápido debe tener de 4 a 6 dígitos")
      return
    }

    if (newUser.role === "WORKSHOP") {
      const slugError = slugFieldError(newUser.publicSlug)
      if (slugError) {
        toast.error(slugError)
        return
      }
    }

    setCreating(true)

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newUser,
          publicSlug: normalizeSlugInput(newUser.publicSlug),
          // Solo personal interno lleva restricciones; para clientes no aplica.
          allowedModules: newUser.role === "CUSTOMER" ? [] : newUser.allowedModules,
          allowedBranchIds: newUser.role === "CUSTOMER" ? [] : newUser.allowedBranchIds,
        }),
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
          homeBranchId: "",
          jobTitle: "",
          quickPin: "",
          publicSlug: "",
          allowedModules: [],
          allowedBranchIds: [],
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

  const openEditDialog = (user: User) => {
    setEditUser(user)
    setEditJobTitle(user.jobTitle ?? "")
    setEditPublicSlug(user.publicSlug ?? "")
    setEditPin("")
    setEditPinClear(false)
    setEditModules(user.allowedModules ?? [])
    setEditBranchesAllowed(user.allowedBranchIds ?? [])
    setEditOpen(true)
  }

  const handleSaveStaff = async () => {
    if (!editUser || editSaving) return
    if (!editPinClear && editPin && !/^\d{4,6}$/.test(editPin)) {
      toast.error("El PIN rápido debe tener de 4 a 6 dígitos")
      return
    }
    if (editUser.role === "WORKSHOP") {
      const slugError = slugFieldError(editPublicSlug)
      if (slugError) {
        toast.error(slugError)
        return
      }
    }
    setEditSaving(true)
    try {
      const payload: { jobTitle: string; quickPin?: string; publicSlug?: string; allowedModules?: string[]; allowedBranchIds?: string[] } = {
        jobTitle: editJobTitle.trim(),
        allowedModules: editModules,
        allowedBranchIds: editBranchesAllowed,
      }
      if (editUser.role === "WORKSHOP") {
        payload.publicSlug = normalizeSlugInput(editPublicSlug)
      }
      if (editPinClear) {
        payload.quickPin = "CLEAR"
      } else if (editPin) {
        payload.quickPin = editPin
      }
      const res = await fetch(`/api/users/${editUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const result = await res.json()
      if (res.ok) {
        toast.success(editUser.role === "WORKSHOP" ? "Datos del taller actualizados" : "Datos del empleado actualizados")
        setEditOpen(false)
        setEditUser(null)
        fetchUsers()
      } else {
        toast.error(result.error || "Error al actualizar")
      }
    } catch {
      toast.error("Error de conexión")
    } finally {
      setEditSaving(false)
    }
  }

  const pendingCount = users.filter((u) => u.status === "PENDING").length

  const openCreditDialog = (user: User) => {
    if (abonoInFlight.current) return
    setCreditUser(user)
    setCreditLimitValue(user.creditLimit?.toString() ?? "")
    setAbonoAmount("")
    setAbonoNotes("")
    setAbonoPaymentMethod("EFECTIVO")
    setAbonoBranch("AUTO")
    setCreditOpen(true)
  }

  const handleSaveCreditLimit = async () => {
    if (!creditUser) return
    const limit = creditLimitValue === "" ? null : parseFloat(creditLimitValue)
    if (limit !== null && (isNaN(limit) || limit < 0)) {
      toast.error("Ingresa un límite válido")
      return
    }
    setCreditSaving(true)
    try {
      const res = await fetch(`/api/credit/users/${creditUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creditLimit: limit }),
      })
      if (res.ok) {
        toast.success(limit === null ? "Línea de crédito removida" : `Límite actualizado a $${limit.toLocaleString()}`)
        fetchUsers()
      } else {
        const data = await res.json()
        toast.error(data.error || "Error al actualizar")
      }
    } catch { toast.error("Error de conexión") }
    finally { setCreditSaving(false) }
  }

  const handleQuickAbono = async () => {
    if (abonoInFlight.current || !creditUser || !abonoAmount) return
    const amount = Number(abonoAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Monto inválido")
      return
    }
    abonoInFlight.current = true
    setAbonoSaving(true)
    try {
      const payload = {
        userId: creditUser.id, amount, notes: abonoNotes || undefined, paymentMethod: abonoPaymentMethod,
        branchId: abonoBranch !== "AUTO" ? abonoBranch : undefined,
      }
      abonoOperation.current = getClientOperationKey(abonoOperation.current, payload)
      const res = await fetch("/api/credit/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, idempotencyKey: abonoOperation.current.key }),
      })
      const data = await res.json()
      if (res.ok) {
        abonoOperation.current = null
        toast.success(`Abono de $${amount.toLocaleString()} registrado`)
        setAbonoAmount("")
        setAbonoNotes("")
        if (typeof data.creditBalance === "number") {
          setCreditUser(current => current?.id === payload.userId ? { ...current, creditBalance: data.creditBalance } : current)
        }
        fetchUsers()
      } else {
        toast.error(data.error || "Error al abonar")
      }
    } catch { toast.error("No se pudo confirmar el abono. Reintenta con los mismos datos para evitar duplicarlo.") }
    finally {
      abonoInFlight.current = false
      setAbonoSaving(false)
    }
  }

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
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Cuentas de clientes, empleados, talleres y administradores
          </p>
          <Link
            href="/admin/clientes"
            className="text-sm text-primary hover:underline inline-flex items-center gap-1 mt-1"
          >
            Ver solo clientes →
          </Link>
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
                      <SelectItem value="WORKSHOP">Taller aliado</SelectItem>
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
                    <SelectTrigger disabled={newUser.role === "ADMIN" || newUser.role === "WORKSHOP"}>
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
              {(newUser.role === "EMPLOYEE" || newUser.role === "ADMIN") && branches.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="homeBranch">Sucursal</Label>
                  <Select
                    value={newUser.homeBranchId}
                    onValueChange={(value) => setNewUser({ ...newUser, homeBranchId: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sin sucursal asignada" />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.filter(b => b.isActive).map(b => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {(newUser.role === "EMPLOYEE" || newUser.role === "ADMIN" || newUser.role === "WORKSHOP") && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="jobTitle">
                      {newUser.role === "WORKSHOP" ? "Nombre del taller" : "Puesto"}
                    </Label>
                    <Input
                      id="jobTitle"
                      list={newUser.role === "WORKSHOP" ? undefined : "puesto-sugerencias"}
                      maxLength={60}
                      value={newUser.jobTitle}
                      onChange={(e) => setNewUser({ ...newUser, jobTitle: e.target.value })}
                      placeholder={newUser.role === "WORKSHOP" ? "Ej: Taller Hermanos Pérez" : "Ej: Técnico"}
                      required={newUser.role === "WORKSHOP"}
                    />
                    {newUser.role === "WORKSHOP" ? (
                      <p className="text-xs text-muted-foreground">
                        Es el nombre que aparecerá en las solicitudes del mercado.
                      </p>
                    ) : (
                      <datalist id="puesto-sugerencias">
                        <option value="Técnico" />
                        <option value="Recepción" />
                        <option value="Dueño" />
                      </datalist>
                    )}
                  </div>
                  {(newUser.role === "EMPLOYEE" || newUser.role === "ADMIN") && (
                    <div className="space-y-2">
                      <Label htmlFor="quickPin">PIN rápido (opcional)</Label>
                      <Input
                        id="quickPin"
                        type="password"
                        inputMode="numeric"
                        maxLength={6}
                        autoComplete="off"
                        value={newUser.quickPin}
                        onChange={(e) => setNewUser({ ...newUser, quickPin: e.target.value.replace(/\D/g, "") })}
                        placeholder="4 a 6 dígitos"
                      />
                    </div>
                  )}
                </div>
              )}
              {newUser.role === "WORKSHOP" && (
                <SlugField
                  id="newUser-publicSlug"
                  label="Link público (slug)"
                  value={newUser.publicSlug}
                  onChange={(value) => setNewUser({ ...newUser, publicSlug: value })}
                  placeholder="taller-hermanos"
                  hint="Sus clientes rastrearán órdenes en /<slug>/order-status. Opcional: déjalo vacío si el taller no tendrá vitrina."
                  disabled={creating}
                />
              )}
              {newUser.role !== "CUSTOMER" && (
                <div className="space-y-3 border-t pt-3">
                  <div className="space-y-2">
                    <Label>Módulos permitidos</Label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {Object.entries(MODULE_LABELS).map(([key, label]) => (
                        <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox
                            checked={newUser.allowedModules.includes(key)}
                            disabled={creating}
                            onCheckedChange={() =>
                              setNewUser({ ...newUser, allowedModules: toggleInList(newUser.allowedModules, key) })
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">Sin selección = acceso a todos</p>
                  </div>
                  {branches.length > 0 && (
                    <div className="space-y-2">
                      <Label>Sucursales permitidas</Label>
                      <div className="grid grid-cols-2 gap-1.5">
                        {branches.map((b) => (
                          <label key={b.id} className="flex items-center gap-2 text-sm cursor-pointer">
                            <Checkbox
                              checked={newUser.allowedBranchIds.includes(b.id)}
                              disabled={creating}
                              onCheckedChange={() =>
                                setNewUser({ ...newUser, allowedBranchIds: toggleInList(newUser.allowedBranchIds, b.id) })
                              }
                            />
                            {b.name}
                          </label>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">Sin selección = acceso a todas las sucursales</p>
                    </div>
                  )}
                </div>
              )}
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
          <TabsTrigger value="talleres" className="flex items-center gap-2">
            <Store className="h-4 w-4" />
            Talleres
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
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
                        <span className="truncate" title={user.name}>{user.name}</span>
                        {user.role === "ADMIN" && (
                          <Badge variant="default" className="bg-amber-500 hover:bg-amber-600 shrink-0">
                            <Crown className="mr-1 h-3 w-3" />
                            Admin
                          </Badge>
                        )}
                        {user.role === "WORKSHOP" && (
                          <Badge variant="secondary" className="shrink-0">
                            <Store className="mr-1 h-3 w-3" />
                            Taller aliado
                          </Badge>
                        )}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
                        {user.telegramId && (
                          <span title="Registrado por Telegram" className="inline-flex items-center gap-1"><Send className="h-3.5 w-3.5" /> Telegram</span>
                        )}
                        {user.phone && (
                          <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {user.phone}</span>
                        )}
                        {!user.telegramId && !user.phone && (
                          <span className="italic">Sin contacto</span>
                        )}
                      </div>
                      {user.role === "WORKSHOP" && user.publicSlug && (
                        <a
                          href={`/${user.publicSlug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1.5 inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs font-medium text-primary transition hover:bg-muted hover:underline"
                          title="Abrir la vitrina pública del taller"
                        >
                          <ExternalLink className="h-3 w-3" />
                          /{user.publicSlug}
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant={statusColors[user.status]}>
                        <StatusIcon className="mr-1 h-3 w-3" />
                        {statusLabels[user.status]}
                      </Badge>
                      {user.role !== "WORKSHOP" && (
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
                      )}
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
                      {(user.allowedModules?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5" title="Módulos permitidos">
                          {user.allowedModules!.map((m) => (
                            <Badge key={m} variant="secondary" className="text-[10px] px-1.5 py-0">
                              {MODULE_LABELS[m as ModuleKey] ?? m}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {(user.allowedBranchIds?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1" title="Sucursales permitidas">
                          {user.allowedBranchIds!.map((id) => (
                            <Badge key={id} variant="outline" className="text-[10px] px-1.5 py-0">
                              {branches.find((b) => b.id === id)?.name ?? "Sucursal"}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
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
                          {user.role !== "ADMIN" && user.role !== "WORKSHOP" && (
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
                                    : user.role === "WORKSHOP"
                                      ? "Taller aliado"
                                      : "Cliente"}
                              </span>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="CUSTOMER">Cliente</SelectItem>
                              <SelectItem value="EMPLOYEE">Empleado</SelectItem>
                              <SelectItem value="WORKSHOP">Taller aliado</SelectItem>
                              <SelectItem value="ADMIN">Administrador</SelectItem>
                            </SelectContent>
                          </Select>
                          {user.role !== "ADMIN" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9 gap-1"
                              onClick={() => openCreditDialog(user)}
                            >
                              <CreditCard className="h-3.5 w-3.5" />
                              Crédito
                            </Button>
                          )}
                          {(user.role === "EMPLOYEE" || user.role === "ADMIN") && branches.length > 0 && (
                            <Select
                              value={user.homeBranchId ?? "none"}
                              onValueChange={(value) =>
                                updateUser(user.id, { homeBranchId: value === "none" ? "" : value })
                              }
                            >
                              <SelectTrigger className="h-9 w-[160px]" disabled={updating === user.id}>
                                <span>{user.homeBranch?.name ?? "Sin sucursal"}</span>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Sin sucursal</SelectItem>
                                {branches.filter(b => b.isActive).map(b => (
                                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                          {(user.role === "EMPLOYEE" || user.role === "ADMIN" || user.role === "WORKSHOP") && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9 gap-1"
                              onClick={() => openEditDialog(user)}
                              disabled={updating === user.id}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Editar
                            </Button>
                          )}
                          {/* "Vigilar al equipo": salta al feed filtrado a esta persona. */}
                          {(user.role === "EMPLOYEE" || user.role === "ADMIN" || user.role === "WORKSHOP") && (
                            <Button size="sm" variant="ghost" className="h-9 gap-1" asChild>
                              <Link
                                href={`/admin/equipo?tab=actividad&actor=${user.id}&anombre=${encodeURIComponent(user.name)}`}
                                title="Ver la actividad de esta persona en el registro"
                              >
                                <History className="h-3.5 w-3.5" />
                                Ver actividad
                              </Link>
                            </Button>
                          )}
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
                query={{
                  // Sin `tab` la paginación sacaría al usuario del tab Usuarios.
                  tab: "usuarios",
                  ...(filter !== "all" ? { status: filter.toUpperCase() } : {}),
                }}
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

      {/* Credit Management Dialog */}
      <Dialog open={creditOpen} onOpenChange={(open) => { if (abonoInFlight.current) return; setCreditOpen(open); if (!open) setCreditUser(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gestión de Crédito</DialogTitle>
          </DialogHeader>
          {creditUser && (
            <div className="space-y-5 py-2">
              <div className="p-3 bg-muted rounded-lg">
                <p className="font-semibold">{creditUser.name}</p>
                <p className="text-xs text-muted-foreground">{creditUser.email}</p>
                {(creditUser.creditBalance ?? 0) > 0 && (
                  <p className="text-sm font-medium text-destructive mt-1">
                    Deuda actual: ${(creditUser.creditBalance ?? 0).toLocaleString()}
                  </p>
                )}
              </div>

              {/* Editar Límite */}
              <div className="space-y-2">
                <Label>Límite de Crédito ($)</Label>
                <div className="flex gap-2 w-full">
                  <Input
                    type="number"
                    className="min-w-0 flex-1"
                    min="0"
                    step="100"
                    placeholder="Ej: 5000 (vacío = sin crédito)"
                    value={creditLimitValue}
                    onChange={(e) => setCreditLimitValue(e.target.value)}
                  />
                  <Button onClick={handleSaveCreditLimit} disabled={creditSaving} size="sm" className="shrink-0">
                    {creditSaving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    Guardar
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Actual: {creditUser.creditLimit != null ? `$${creditUser.creditLimit.toLocaleString()}` : "Sin crédito"}
                </p>
              </div>

              {/* Abono Rápido */}
              {(creditUser.creditBalance ?? 0) > 0 && (
                <div className="space-y-2 border-t pt-4">
                  <Label>Registrar Abono Rápido</Label>
                  <div className="space-y-2">
                    <Label htmlFor="abono-payment-method">Medio de abono</Label>
                    <Select
                      value={abonoPaymentMethod}
                      onValueChange={(value) => { if (!abonoInFlight.current) setAbonoPaymentMethod(value as "EFECTIVO" | "TARJETA" | "TRANSFERENCIA") }}
                    >
                      <SelectTrigger id="abono-payment-method" disabled={abonoSaving}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="EFECTIVO">Efectivo</SelectItem>
                        <SelectItem value="TARJETA">Tarjeta</SelectItem>
                        <SelectItem value="TRANSFERENCIA">Transferencia</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {abonoPaymentMethod === "EFECTIVO"
                        ? "Efectivo: requiere caja abierta y registra una entrada de dinero."
                        : "Este abono reduce la deuda sin registrar efectivo en caja."}
                    </p>
                  </div>
                  {abonoPaymentMethod === "EFECTIVO" && branches.filter(b => b.isActive).length > 1 && (
                    <div className="space-y-2">
                      <Label htmlFor="abono-branch">Sucursal donde se cobra</Label>
                      <Select value={abonoBranch} onValueChange={(value) => { if (!abonoInFlight.current) setAbonoBranch(value) }}>
                        <SelectTrigger id="abono-branch" disabled={abonoSaving}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="AUTO">Mi sucursal (predeterminada)</SelectItem>
                          {branches.filter(b => b.isActive).map(b => (
                            <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="flex gap-2 w-full">
                    <Input
                      type="number"
                      className="min-w-0 flex-1"
                      min="0.01"
                      step="0.01"
                      placeholder="Monto"
                      value={abonoAmount}
                      disabled={abonoSaving}
                      onChange={(e) => setAbonoAmount(e.target.value)}
                    />
                    <Button
                      onClick={handleQuickAbono}
                      disabled={abonoSaving || !abonoAmount || parseFloat(abonoAmount) <= 0}
                      size="sm"
                      className="shrink-0 bg-green-600 hover:bg-green-700"
                    >
                      {abonoSaving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                      <DollarSign className="h-3.5 w-3.5 mr-1" />Abonar
                    </Button>
                  </div>
                  <Input
                    placeholder="Notas (opcional)"
                    value={abonoNotes}
                    disabled={abonoSaving}
                    maxLength={500}
                    onChange={(e) => setAbonoNotes(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditOpen(false)} disabled={abonoSaving}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Staff edit dialog: puesto + PIN rápido (o nombre del taller para WORKSHOP) */}
      <Dialog open={editOpen} onOpenChange={(open) => { if (editSaving) return; setEditOpen(open); if (!open) setEditUser(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editUser?.role === "WORKSHOP" ? "Editar taller aliado" : "Editar empleado"}</DialogTitle>
          </DialogHeader>
          {editUser && (
            <div className="space-y-4 py-2">
              <div className="p-3 bg-muted rounded-lg">
                <p className="font-semibold">{editUser.name}</p>
                <p className="text-xs text-muted-foreground">{editUser.email}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-jobTitle">
                  {editUser.role === "WORKSHOP" ? "Nombre del taller" : "Puesto"}
                </Label>
                <Input
                  id="edit-jobTitle"
                  list={editUser.role === "WORKSHOP" ? undefined : "puesto-sugerencias-edit"}
                  maxLength={60}
                  value={editJobTitle}
                  disabled={editSaving}
                  onChange={(e) => setEditJobTitle(e.target.value)}
                  placeholder={editUser.role === "WORKSHOP" ? "Ej: Taller Hermanos Pérez" : "Ej: Técnico"}
                />
                {editUser.role === "WORKSHOP" ? (
                  <p className="text-xs text-muted-foreground">
                    Es el nombre que aparecerá en las solicitudes del mercado.
                  </p>
                ) : (
                  <datalist id="puesto-sugerencias-edit">
                    <option value="Técnico" />
                    <option value="Recepción" />
                    <option value="Dueño" />
                  </datalist>
                )}
              </div>
              {editUser.role === "WORKSHOP" && (
                <SlugField
                  id="edit-publicSlug"
                  label="Link público (slug)"
                  value={editPublicSlug}
                  onChange={setEditPublicSlug}
                  placeholder="taller-hermanos"
                  hint="Sus clientes rastrearán órdenes en /<slug>/order-status. Vacío = sin vitrina pública."
                  disabled={editSaving}
                />
              )}
              {editUser.role !== "WORKSHOP" && (
              <div className="space-y-2">
                <Label htmlFor="edit-pin">PIN rápido</Label>
                <Input
                  id="edit-pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="off"
                  value={editPin}
                  disabled={editPinClear || editSaving}
                  onChange={(e) => setEditPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="4 a 6 dígitos"
                />
                <p className="text-xs text-muted-foreground">
                  Para el cambio rápido de usuario. Vacío = sin cambio.
                </p>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={editPinClear}
                    disabled={editSaving}
                    onCheckedChange={(value) => setEditPinClear(value === true)}
                  />
                  Quitar PIN actual
                </label>
              </div>
              )}
              <div className="space-y-3 border-t pt-3">
                <div className="space-y-2">
                  <Label>Módulos permitidos</Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {Object.entries(MODULE_LABELS).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={editModules.includes(key)}
                          disabled={editSaving}
                          onCheckedChange={() => setEditModules(toggleInList(editModules, key))}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Sin selección = acceso a todos</p>
                </div>
                {branches.length > 0 && (
                  <div className="space-y-2">
                    <Label>Sucursales permitidas</Label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {branches.map((b) => (
                        <label key={b.id} className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox
                            checked={editBranchesAllowed.includes(b.id)}
                            disabled={editSaving}
                            onCheckedChange={() => setEditBranchesAllowed(toggleInList(editBranchesAllowed, b.id))}
                          />
                          {b.name}
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">Sin selección = acceso a todas las sucursales</p>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={editSaving}>
              Cancelar
            </Button>
            <Button onClick={handleSaveStaff} disabled={editSaving}>
              {editSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
