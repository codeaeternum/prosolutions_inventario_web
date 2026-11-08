"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
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
import {
  AlertTriangle,
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
  RefreshCw,
  Search,
  Download,
  Wallet,
} from "lucide-react"
import { toast } from "sonner"
import { formatDate } from "@/lib/utils"
import { csvCell } from "@/lib/csv"
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
  /** Esquema de pago (nómina): lo agrega la API de users; por eso va opcional
   *  y todo su uso es con optional chaining (NONE = sin esquema). */
  payType?: string | null
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

export type UsuariosGrupo = "clientes" | "empleados" | "talleres" | "administradores" | "pendientes"
export type UsuariosStatusFilter = "all" | "pending" | "approved" | "rejected"

const GRUPOS_VALIDOS: readonly string[] = ["clientes", "empleados", "talleres", "administradores", "pendientes"]
const STATUS_VALIDOS: readonly string[] = ["pending", "approved", "rejected"]

/**
 * Grupo de cuentas desde la URL (`?grupo=`). `?filter=pending` —link viejo
 * "Revisar" del dashboard— aterriza en Pendientes; valor inválido → Clientes.
 * Los filtros viven en searchParams para que sobrevivan reload y se puedan
 * compartir, igual que `?tab=` en equipo-panel.
 */
export function grupoFromParams(get: (key: string) => string | null): UsuariosGrupo {
  const raw = get("grupo")
  if (raw && GRUPOS_VALIDOS.includes(raw)) return raw as UsuariosGrupo
  if (get("filter") === "pending") return "pendientes"
  return "clientes"
}

export function statusFilterFromParams(get: (key: string) => string | null): UsuariosStatusFilter {
  const raw = get("status")?.toLowerCase() ?? ""
  return STATUS_VALIDOS.includes(raw) ? (raw as UsuariosStatusFilter) : "all"
}

/**
 * Búsqueda instantánea sobre la página cargada: nombre, correo, teléfono,
 * puesto y sucursal base. (El servidor además filtra todo el directorio por
 * nombre/correo/teléfono con `?search=` — puesto y sucursal son extra local.)
 */
export function userMatchesQuery(
  user: {
    name: string
    email: string
    phone?: string | null
    jobTitle?: string | null
    homeBranch?: { name: string } | null
  },
  query: string
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [user.name, user.email, user.phone ?? "", user.jobTitle ?? "", user.homeBranch?.name ?? ""]
    .some((field) => field.toLowerCase().includes(q))
}

/**
 * Orden de revisión: las cuentas PENDING van primero (las más nuevas arriba,
 * que son las que esperan respuesta) y el resto conserva el orden del
 * servidor. Así el registro nuevo nunca queda enterrado bajo 20 aprobados.
 */
export function sortUsersForReview<T extends { status: string; createdAt: string }>(list: T[]): T[] {
  const pending: T[] = []
  const rest: T[] = []
  for (const item of list) (item.status === "PENDING" ? pending : rest).push(item)
  pending.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return [...pending, ...rest]
}

/** Acciones de cuenta que piden confirmación antes de tocar el servidor. */
type ConfirmAction = {
  user: User
  to: "APPROVED" | "REJECTED"
  kind: "aprobar" | "rechazar" | "suspender" | "reactivar"
}

export function UsuariosPanel() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const pageFromUrl = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
  const limitFromUrl = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT))

  // Filtros derivados de la URL: ?grupo, ?status y ?q (más ?page/?limit).
  const getParam = useCallback((key: string) => searchParams.get(key), [searchParams])
  const grupo = grupoFromParams(getParam)
  const statusFilter = statusFilterFromParams(getParam)
  const qFromUrl = searchParams.get("q") ?? ""

  const [users, setUsers] = useState<User[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Conteo global de pendientes para el badge del tab (la página visible no
  // basta: puede haber pendientes repartidos en otras páginas).
  const [pendingTotal, setPendingTotal] = useState(0)

  // El input filtra al instante en cliente; la URL se sincroniza con debounce
  // para no hacer un router.replace por tecla.
  const [searchInput, setSearchInput] = useState(qFromUrl)
  const lastSyncedQ = useRef(qFromUrl)

  const [updating, setUpdating] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)

  /**
   * Escribe filtros en la URL (replace: no ensucia el historial). `null` o ""
   * borran la clave; `filter` (formato viejo) siempre se limpia porque su
   * equivalente moderno es `grupo`.
   */
  const updateParams = useCallback((changes: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("filter")
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") params.delete(key)
      else params.set(key, value)
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [searchParams, pathname, router])

  const handleGrupoChange = (value: string) => {
    updateParams({
      grupo: value === "clientes" ? null : value,
      page: null,
      // En Pendientes el estatus va implícito: limpiar evita combos sin sentido.
      ...(value === "pendientes" ? { status: null } : {}),
    })
  }

  const handleStatusFilter = (value: UsuariosStatusFilter) => {
    updateParams({ status: value === "all" ? null : value, page: null })
  }
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
  const [abonoReference, setAbonoReference] = useState("")
  const [abonoSaving, setAbonoSaving] = useState(false)
  const [abonoPaymentMethod, setAbonoPaymentMethod] = useState<"EFECTIVO" | "TARJETA" | "TRANSFERENCIA">("EFECTIVO")
  // Sucursal donde entra el efectivo del abono; "AUTO" = sucursal base del cobrador.
  const [abonoBranch, setAbonoBranch] = useState("AUTO")
  const abonoOperation = useRef<ClientOperationKey | null>(null)
  const abonoInFlight = useRef(false)

  // Guard de carrera: si los filtros cambian rápido (teclear en el buscador),
  // solo la última respuesta aterriza en estado.
  const fetchSeq = useRef(0)

  const fetchUsers = useCallback(async () => {
    const version = ++fetchSeq.current
    setLoadError(null)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== "all") params.set("status", statusFilter.toUpperCase())

      if (grupo === "empleados") {
        params.set("role", "EMPLOYEE")
      } else if (grupo === "talleres") {
        params.set("role", "WORKSHOP")
      } else if (grupo === "administradores") {
        params.set("role", "ADMIN")
      } else if (grupo === "pendientes") {
        params.set("status", "PENDING")
      } else {
        // clientes
        params.set("role", "CUSTOMER")
      }

      // Búsqueda en TODO el directorio (no solo la página visible): el server
      // filtra por nombre/correo/teléfono; puesto/sucursal se cubren con el
      // filtro local sobre la página cargada.
      if (qFromUrl) params.set("search", qFromUrl)

      params.set("page", String(pageFromUrl))
      params.set("limit", String(limitFromUrl))

      // Conteo total de pendientes en paralelo (1 fila, trae `total`): el
      // badge del tab refleja toda la cuenta, no solo lo que se ve.
      const [res, pendingRes] = await Promise.all([
        fetch(`/api/users?${params}`),
        fetch("/api/users?status=PENDING&limit=1").catch(() => null),
      ])
      const data = await res.json().catch(() => null)
      if (version !== fetchSeq.current) return
      if (!res.ok) throw new Error("respuesta no OK")
      if (pendingRes?.ok) {
        const p = await pendingRes.json().catch(() => null)
        if (version === fetchSeq.current && typeof p?.total === "number") {
          setPendingTotal(p.total)
        }
      }
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
      if (version !== fetchSeq.current) return
      console.error("Error fetching users:", error)
      setLoadError("No se pudieron cargar los usuarios")
      toast.error("No se pudieron cargar los usuarios. Reintenta en un momento.")
    } finally {
      if (version === fetchSeq.current) setLoading(false)
    }
  }, [grupo, statusFilter, qFromUrl, pageFromUrl, limitFromUrl])

  // Microtask: setState síncrono en el effect dispararía renders en cascada
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    queueMicrotask(() => void fetchUsers())
  }, [fetchUsers])

  const handleRetry = () => {
    setLoading(true)
    setLoadError(null)
    void fetchUsers()
  }

  // ?q externo (atrás/adelante del navegador o link) → espeja al input.
  useEffect(() => {
    if (qFromUrl !== lastSyncedQ.current) {
      lastSyncedQ.current = qFromUrl
      queueMicrotask(() => setSearchInput(qFromUrl))
    }
  }, [qFromUrl])

  // Input → URL con debounce: el filtrado local es instantáneo y la URL queda
  // compartible/recargable sin un router.replace por cada tecla.
  useEffect(() => {
    if (searchInput === qFromUrl) return
    const timer = setTimeout(() => {
      lastSyncedQ.current = searchInput
      updateParams({ q: searchInput || null, page: null })
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput, qFromUrl, updateParams])

  useEffect(() => {
    fetch("/api/branches")
      .then(res => res.ok ? res.json() : null)
      .then(data => setBranches(data?.branches ?? []))
      .catch(() => setBranches([]))
  }, [])

  const updateUser = async (
    id: string,
    data: { status?: string; customerType?: string; role?: string; homeBranchId?: string },
    opts?: { successToast?: string }
  ) => {
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
        if (opts?.successToast) {
          toast.success(opts.successToast)
        } else if (data.status === "APPROVED") {
          toast.success("Usuario aprobado exitosamente")
        } else if (data.status === "REJECTED") {
          toast.success("Usuario rechazado")
        } else if (data.customerType) {
          toast.success(`Tipo de cliente actualizado a ${data.customerType === "STORE" ? "Tienda" : data.customerType === "TECHNICIAN" ? "Técnico" : "Particular"}`)
        } else if (data.role === "ADMIN") {
          toast.success("Usuario promovido a Administrador")
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

  const confirmCopy: Record<ConfirmAction["kind"], { title: (name: string) => string; desc: string; cta: string; toast: string }> = {
    aprobar: {
      title: (name) => `¿Aprobar la cuenta de ${name}?`,
      desc: "Podrá iniciar sesión y usar la plataforma con el rol que tenga asignado.",
      cta: "Sí, aprobar",
      toast: "Cuenta aprobada: ya puede iniciar sesión",
    },
    rechazar: {
      title: (name) => `¿Rechazar la cuenta de ${name}?`,
      desc: "No podrá entrar. Si fue un error, después puedes reactivarla desde Rechazados.",
      cta: "Sí, rechazar",
      toast: "Cuenta rechazada",
    },
    suspender: {
      title: (name) => `¿Suspender a ${name}?`,
      desc: "Perderá acceso de inmediato hasta que la reactives. Su historial y datos se conservan.",
      cta: "Sí, suspender",
      toast: "Cuenta suspendida. Puedes reactivarla cuando quieras",
    },
    reactivar: {
      title: (name) => `¿Reactivar la cuenta de ${name}?`,
      desc: "Recuperará el acceso con el rol y los datos que tenía.",
      cta: "Sí, reactivar",
      toast: "Cuenta reactivada",
    },
  }

  const openCreditDialog = (user: User) => {
    if (abonoInFlight.current) return
    setCreditUser(user)
    setCreditLimitValue(user.creditLimit?.toString() ?? "")
    setAbonoAmount("")
    setAbonoNotes("")
    setAbonoReference("")
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
    // Tarjeta/transferencia exigen folio (el servidor pide mínimo 4 caracteres).
    if (abonoPaymentMethod !== "EFECTIVO" && abonoReference.trim().length < 4) {
      toast.error("Captura la referencia del abono (mínimo 4 caracteres)")
      return
    }
    abonoInFlight.current = true
    setAbonoSaving(true)
    try {
      const payload = {
        userId: creditUser.id, amount, notes: abonoNotes || undefined, paymentMethod: abonoPaymentMethod,
        reference: abonoPaymentMethod !== "EFECTIVO" ? abonoReference.trim() : undefined,
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
        setAbonoReference("")
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

  const roleLabels: Record<User["role"], string> = {
    ADMIN: "Administrador",
    EMPLOYEE: "Empleado",
    WORKSHOP: "Taller aliado",
    CUSTOMER: "Cliente",
  }

  const customerTypeLabels: Record<User["customerType"], string> = {
    NORMAL: "Particular",
    TECHNICIAN: "Técnico",
    STORE: "Tienda",
  }

  // Pendientes primero (esperan respuesta) y luego filtro instantáneo por
  // nombre/correo/teléfono/puesto/sucursal sobre la página cargada.
  const filteredUsers = useMemo(() => {
    const ordered = sortUsersForReview(users)
    if (!searchInput.trim()) return ordered
    return ordered.filter((u) => userMatchesQuery(u, searchInput))
  }, [users, searchInput])

  // Query que la paginación conserva en sus links (tab + filtros vigentes).
  // `filter` viejo se traduce a `grupo` para que los links salgan limpios.
  const paginationQuery = useMemo(() => {
    const query: Record<string, string> = { tab: "usuarios" }
    searchParams.forEach((value, key) => {
      if (key !== "page" && key !== "limit" && key !== "filter") query[key] = value
    })
    if (!query.grupo && grupo !== "clientes") query.grupo = grupo
    return query
  }, [searchParams, grupo])

  const handleExportCsv = () => {
    if (filteredUsers.length === 0) return
    const headers = [
      "Nombre",
      "Correo",
      "Teléfono",
      "Rol",
      "Tipo Cliente",
      "Estado",
      "Sucursal Base",
      "Puesto",
      "Saldo Crédito",
      "Límite Crédito",
      "Fecha Registro",
    ]
    const rows = filteredUsers.map((u) => [
      u.name,
      u.email,
      u.phone ?? "",
      roleLabels[u.role] ?? u.role,
      customerTypeLabels[u.customerType] ?? u.customerType,
      statusLabels[u.status] ?? u.status,
      u.homeBranch?.name ?? "",
      u.jobTitle ?? "",
      u.creditBalance ?? 0,
      u.creditLimit ?? "",
      formatDate(u.createdAt),
    ])
    const lines = [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))]
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `usuarios-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  // Skeleton con la forma del contenido (barra + tabs + tarjetas): mejor que
  // un spinner porque el layout no brinca al terminar de cargar.
  if (loading && users.length === 0 && !loadError) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Cargando usuarios">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <Skeleton className="h-5 w-72" />
          <Skeleton className="h-9 w-40" />
        </div>
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-10 w-full max-w-lg" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border p-5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
                <Skeleton className="h-5 w-20" />
              </div>
              <div className="flex gap-2 pt-2">
                <Skeleton className="h-9 w-24" />
                <Skeleton className="h-9 w-24" />
              </div>
            </div>
          ))}
        </div>
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
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={filteredUsers.length === 0}
            aria-label="Exportar usuarios a CSV"
            onClick={handleExportCsv}
          >
            <Download className="mr-2 h-4 w-4" />
            Exportar CSV
          </Button>
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
                <Label htmlFor="email">Correo electrónico</Label>
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
                    <SelectTrigger id="role">
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
                    <SelectTrigger id="customerType" disabled={newUser.role === "ADMIN" || newUser.role === "WORKSHOP"}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NORMAL">Particular</SelectItem>
                      <SelectItem value="TECHNICIAN">Técnico</SelectItem>
                      <SelectItem value="STORE">Tienda (Taller)</SelectItem>
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
                    <SelectTrigger id="homeBranch">
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
                  <div className="space-y-2" role="group" aria-labelledby="create-modules-label">
                    <p id="create-modules-label" className="text-sm font-medium leading-none">Módulos permitidos</p>
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
                    <div className="space-y-2" role="group" aria-labelledby="create-branches-label">
                      <p id="create-branches-label" className="text-sm font-medium leading-none">Sucursales permitidas</p>
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
      </div>

      {/* Instant Search Bar */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          id="usuarios-search"
          placeholder="Buscar por nombre, correo, teléfono o puesto..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          aria-label="Buscar usuarios por nombre, correo, teléfono o puesto"
          className="pl-9"
        />
      </div>

      {/* Filter Tabs */}
      <Tabs value={grupo} onValueChange={handleGrupoChange} className="w-full">
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
            <span aria-live="polite" className="inline-flex">
              {pendingTotal > 0 && (
                <Badge
                  variant="destructive"
                  className="ml-1 px-1.5 min-w-[20px] h-5 flex items-center justify-center"
                  aria-label={`${pendingTotal} cuentas pendientes de aprobación`}
                >
                  {pendingTotal}
                </Badge>
              )}
            </span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value={grupo}>
          {/* Chips de estatus: acceso rápido sin abrir dropdowns. En
              "pendientes" van implícitos (todas son PENDING). */}
          {grupo !== "pendientes" && (
            <div className="flex gap-2 flex-wrap mb-4 items-center">
              <Button
                variant={statusFilter === "all" ? "default" : "outline"}
                size="sm"
                aria-pressed={statusFilter === "all"}
                onClick={() => handleStatusFilter("all")}
              >
                Todos
              </Button>
              <Button
                variant={statusFilter === "pending" ? "default" : "outline"}
                size="sm"
                aria-pressed={statusFilter === "pending"}
                onClick={() => handleStatusFilter("pending")}
              >
                <Clock className="mr-2 h-4 w-4" />
                Pendientes
              </Button>
              <Button
                variant={statusFilter === "approved" ? "default" : "outline"}
                size="sm"
                aria-pressed={statusFilter === "approved"}
                onClick={() => handleStatusFilter("approved")}
              >
                <UserCheck className="mr-2 h-4 w-4" />
                Aprobados
              </Button>
              <Button
                variant={statusFilter === "rejected" ? "default" : "outline"}
                size="sm"
                aria-pressed={statusFilter === "rejected"}
                onClick={() => handleStatusFilter("rejected")}
              >
                <XCircle className="mr-2 h-4 w-4" />
                Rechazados
              </Button>
              <span className="text-sm text-muted-foreground ml-auto" aria-live="polite">
                {total} {total === 1 ? "usuario" : "usuarios"}
                {searchInput.trim() ? " encontrados" : ""}
              </span>
            </div>
          )}

      {/* Users List */}
      <div className="space-y-4">
        {filteredUsers.length > 0 ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredUsers.map((user) => {
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
                        {/* El API de users va a exponer `payType`; mientras no
                            llegue el campo, esto simplemente no se pinta. */}
                        {user.payType && user.payType !== "NONE" && (
                          <Badge
                            variant="outline"
                            className="shrink-0 border-emerald-500/50 text-emerald-700 dark:text-emerald-300"
                            title="Tiene esquema de pago configurado (nómina)"
                          >
                            <Wallet className="mr-1 h-3 w-3" />
                            Con pago
                          </Badge>
                        )}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                      {/* Puesto y sucursal base a la vista: antes solo vivían
                          dentro de diálogos/selects y había que abrir cada
                          cuenta para saber quién es quién. */}
                      {(user.jobTitle || user.homeBranch?.name) && (
                        <p className="text-sm font-medium text-foreground/80 truncate mt-0.5">
                          {[
                            user.jobTitle,
                            user.homeBranch?.name ? `Sucursal ${user.homeBranch.name}` : null,
                          ].filter(Boolean).join(" · ")}
                        </p>
                      )}
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
                            onClick={() => setConfirmAction({ user, to: "REJECTED", kind: "rechazar" })}
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
                            onClick={() => setConfirmAction({ user, to: "APPROVED", kind: "aprobar" })}
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
                              <SelectTrigger
                                className="h-9 w-[140px]"
                                disabled={updating === user.id}
                                aria-label={`Tipo de cliente de ${user.name}`}
                              >
                                <span>
                                  {user.customerType === "STORE"
                                    ? "Tienda (Taller)"
                                    : user.customerType === "TECHNICIAN"
                                      ? "Técnico"
                                      : "Particular"}
                                </span>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="NORMAL">Particular</SelectItem>
                                <SelectItem value="TECHNICIAN">Técnico</SelectItem>
                                <SelectItem value="STORE">Tienda (Taller)</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                          <Select
                            value={user.role}
                            onValueChange={(value) =>
                              updateUser(user.id, { role: value })
                            }
                          >
                            <SelectTrigger
                              className="h-9 w-[140px]"
                              disabled={updating === user.id}
                              aria-label={`Rol de ${user.name}`}
                            >
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
                              <SelectTrigger
                                className="h-9 w-[160px]"
                                disabled={updating === user.id}
                                aria-label={`Sucursal base de ${user.name}`}
                              >
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
                          {/* Suspender: corta el acceso sin borrar la cuenta
                              (queda como "Rechazado" y se puede reactivar).
                              No se ofrece sobre admins para no auto-bloquearse. */}
                          {user.role !== "ADMIN" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-9 gap-1 text-destructive hover:text-destructive"
                              onClick={() => setConfirmAction({ user, to: "REJECTED", kind: "suspender" })}
                              disabled={updating === user.id}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              Suspender
                            </Button>
                          )}
                        </>
                      )}

                      {user.status === "REJECTED" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setConfirmAction({ user, to: "APPROVED", kind: "reactivar" })}
                          disabled={updating === user.id}
                        >
                          {updating === user.id ? (
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle className="mr-1 h-4 w-4" />
                          )}
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
                query={paginationQuery}
              />
            </div>
          </>
        ) : loadError ? (
          // Error a pantalla completa solo cuando no hay nada que mostrar.
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
            <AlertTriangle className="h-10 w-10 text-destructive" />
            <p className="text-sm text-destructive">{loadError}</p>
            <Button variant="outline" size="sm" onClick={handleRetry}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Reintentar
            </Button>
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <Users className="h-16 w-16 mx-auto mb-4 opacity-50" />
            {searchInput.trim() ? (
              <>
                <p>Sin resultados para &ldquo;{searchInput.trim()}&rdquo;.</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => setSearchInput("")}>
                  Limpiar búsqueda
                </Button>
              </>
            ) : statusFilter !== "all" ? (
              <>
                <p>
                  No hay usuarios con estatus &ldquo;{statusLabels[statusFilter.toUpperCase() as keyof typeof statusLabels]?.toLowerCase()}&rdquo; en este grupo.
                </p>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => handleStatusFilter("all")}>
                  Ver todos
                </Button>
              </>
            ) : (
              <>
                <p>
                  {grupo === "pendientes"
                    ? "Todo al día: no hay cuentas esperando aprobación."
                    : grupo === "empleados"
                      ? "Aún no hay empleados. Crea la primera cuenta para delegar módulos."
                      : grupo === "talleres"
                        ? "Aún no hay talleres aliados."
                        : grupo === "administradores"
                          ? "No hay administradores adicionales."
                          : "Aún no hay clientes registrados."}
                </p>
                {grupo !== "pendientes" && grupo !== "administradores" && (
                  <Button className="mt-4" onClick={() => setCreateOpen(true)}>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Crear usuario
                  </Button>
                )}
              </>
            )}
          </div>
        )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Confirmación de acciones de cuenta: la copia dice qué pasa al
          confirmar (no un genérico "¿estás seguro?"). */}
      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => { if (!open) setConfirmAction(null) }}
      >
        <AlertDialogContent>
          {confirmAction && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {confirmCopy[confirmAction.kind].title(confirmAction.user.name)}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {confirmCopy[confirmAction.kind].desc}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    const action = confirmAction
                    setConfirmAction(null)
                    void updateUser(
                      action.user.id,
                      { status: action.to },
                      { successToast: confirmCopy[action.kind].toast }
                    )
                  }}
                >
                  {confirmCopy[confirmAction.kind].cta}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

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
                {(creditUser.jobTitle || creditUser.phone || creditUser.homeBranch?.name) && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {[
                      creditUser.jobTitle,
                      creditUser.phone,
                      creditUser.homeBranch?.name ? `Sucursal ${creditUser.homeBranch.name}` : null,
                    ].filter(Boolean).join(" · ")}
                  </p>
                )}
                {(creditUser.creditBalance ?? 0) > 0 && (
                  <p className="text-sm font-medium text-destructive mt-1">
                    Deuda actual: ${(creditUser.creditBalance ?? 0).toLocaleString()}
                  </p>
                )}
              </div>

              {/* Editar Límite */}
              <div className="space-y-2">
                <Label htmlFor="credit-limit-input">Límite de Crédito ($)</Label>
                <div className="flex gap-2 w-full">
                  <Input
                    id="credit-limit-input"
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
                  <p className="text-sm font-medium leading-none">Registrar Abono Rápido</p>
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
                        : "Este abono reduce la deuda sin registrar efectivo en caja; la referencia es su rastro."}
                    </p>
                  </div>
                  {abonoPaymentMethod !== "EFECTIVO" && (
                    <Input
                      placeholder="Referencia (folio SPEI/autorización, mín. 4 caracteres)"
                      aria-label="Referencia del abono"
                      value={abonoReference}
                      disabled={abonoSaving}
                      maxLength={200}
                      onChange={(e) => setAbonoReference(e.target.value)}
                    />
                  )}
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
                      aria-label="Monto del abono"
                      value={abonoAmount}
                      disabled={abonoSaving}
                      onChange={(e) => setAbonoAmount(e.target.value)}
                    />
                    <Button
                      onClick={handleQuickAbono}
                      disabled={abonoSaving || !abonoAmount || parseFloat(abonoAmount) <= 0 || (abonoPaymentMethod !== "EFECTIVO" && abonoReference.trim().length < 4)}
                      size="sm"
                      className="shrink-0 bg-green-600 hover:bg-green-700"
                    >
                      {abonoSaving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                      <DollarSign className="h-3.5 w-3.5 mr-1" />Abonar
                    </Button>
                  </div>
                  <Input
                    placeholder="Notas (opcional)"
                    aria-label="Notas del abono"
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
                {(editUser.phone || editUser.homeBranch?.name) && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {[
                      editUser.phone,
                      editUser.homeBranch?.name ? `Sucursal ${editUser.homeBranch.name}` : null,
                    ].filter(Boolean).join(" · ")}
                  </p>
                )}
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
                <div className="space-y-2" role="group" aria-labelledby="edit-modules-label">
                  <p id="edit-modules-label" className="text-sm font-medium leading-none">Módulos permitidos</p>
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
                  <div className="space-y-2" role="group" aria-labelledby="edit-branches-label">
                    <p id="edit-branches-label" className="text-sm font-medium leading-none">Sucursales permitidas</p>
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
