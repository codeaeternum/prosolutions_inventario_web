"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Users,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  Loader2,
  Plus,
  CreditCard,
  FileText,
  Wallet,
  Search,
  RefreshCw,
} from "lucide-react"
import { toast } from "sonner"

interface DebtorUser {
  id: string
  name: string
  phone: string | null
  creditLimit: number | null
  creditBalance: number | null
}

const creditMovementLabels = { DEBT: "Cargo", PAYMENT: "Abono", REVERSAL: "Reversión de deuda" } as const

interface CreditMovement {
  id: string
  amount: number
  type: "DEBT" | "PAYMENT" | "REVERSAL"
  referenceType: string | null
  notes: string | null
  createdAt: string
  user: { name: string }
}

interface UserCreditDetail {
  id: string
  name: string
  email: string | null
  creditLimit: number | null
  creditBalance: number | null
  creditMovements: Array<{
    id: string
    amount: number
    type: "DEBT" | "PAYMENT" | "REVERSAL"
    referenceType: string | null
    notes: string | null
    createdAt: string
  }>
}

interface SearchUser {
  id: string
  name: string
  email: string | null
  phone: string | null
  creditLimit: number | null
  creditBalance: number
}

function formatPrice(n: number) {
  return "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default function CreditoPage() {
  // Data state
  const [loading, setLoading] = useState(true)
  const paymentOperation = useRef<ClientOperationKey | null>(null)
  const paymentInFlight = useRef(false)
  const debtOperation = useRef<ClientOperationKey | null>(null)
  const [totalDebt, setTotalDebt] = useState(0)
  const [activeClients, setActiveClients] = useState(0)
  const [monthPayments, setMonthPayments] = useState(0)
  const [debtors, setDebtors] = useState<DebtorUser[]>([])
  const [movements, setMovements] = useState<CreditMovement[]>([])

  // Modal states
  const [abonarOpen, setAbonarOpen] = useState(false)
  const [abonarUser, setAbonarUser] = useState<DebtorUser | null>(null)
  const [abonarAmount, setAbonarAmount] = useState("")
  const [abonarNotes, setAbonarNotes] = useState("")
  const [abonarLoading, setAbonarLoading] = useState(false)
  const [abonarPaymentMethod, setAbonarPaymentMethod] = useState<"EFECTIVO" | "TARJETA" | "TRANSFERENCIA">("EFECTIVO")

  const [estadoCuentaOpen, setEstadoCuentaOpen] = useState(false)
  const [estadoCuentaUser, setEstadoCuentaUser] = useState<UserCreditDetail | null>(null)
  const [estadoCuentaLoading, setEstadoCuentaLoading] = useState(false)

  const [darCreditoOpen, setDarCreditoOpen] = useState(false)
  const [darCreditoSearch, setDarCreditoSearch] = useState("")
  const [darCreditoResults, setDarCreditoResults] = useState<SearchUser[]>([])
  const [darCreditoSearching, setDarCreditoSearching] = useState(false)
  const [darCreditoUser, setDarCreditoUser] = useState<SearchUser | null>(null)
  const [darCreditoLimit, setDarCreditoLimit] = useState("")
  const [darCreditoLoading, setDarCreditoLoading] = useState(false)

  const [cargoOpen, setCargoOpen] = useState(false)
  const [cargoSearch, setCargoSearch] = useState("")
  const [cargoResults, setCargoResults] = useState<SearchUser[]>([])
  const [cargoSearching, setCargoSearching] = useState(false)
  const [cargoUser, setCargoUser] = useState<SearchUser | null>(null)
  const [cargoAmount, setCargoAmount] = useState("")
  const [cargoNotes, setCargoNotes] = useState("")
  const [cargoLoading, setCargoLoading] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/credit/movements?summary=true")
      const data = await res.json()
      setTotalDebt(data.totalDebt ?? 0)
      setActiveClients(data.activeClients ?? 0)
      setMonthPayments(data.monthPayments ?? 0)
      setDebtors(data.debtors ?? [])
      setMovements(data.movements ?? [])
    } catch {
      toast.error("Error al cargar datos de crédito")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // ==================== ABONAR ====================
  const openAbonar = (user: DebtorUser) => {
    if (paymentInFlight.current) return
    setAbonarUser(user)
    setAbonarAmount("")
    setAbonarNotes("")
    setAbonarPaymentMethod("EFECTIVO")
    setAbonarOpen(true)
  }

  const handleAbonar = async () => {
    if (paymentInFlight.current || !abonarUser || !abonarAmount) return
    const amount = Number(abonarAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Ingresa un monto válido mayor a 0")
      return
    }
    paymentInFlight.current = true
    setAbonarLoading(true)
    try {
      const payload = { userId: abonarUser.id, amount, notes: abonarNotes || undefined, paymentMethod: abonarPaymentMethod }
      paymentOperation.current = getClientOperationKey(paymentOperation.current, payload)
      const res = await fetch("/api/credit/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          idempotencyKey: paymentOperation.current.key,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        paymentOperation.current = null
        toast.success(`Abono de ${formatPrice(amount)} registrado para ${abonarUser.name}`)
        setAbonarOpen(false)
        fetchData()
      } else {
        toast.error(data.error || "Error al registrar abono")
      }
    } catch {
      toast.error("No se pudo confirmar el abono. Reintenta con los mismos datos para evitar duplicarlo.")
    } finally {
      paymentInFlight.current = false
      setAbonarLoading(false)
    }
  }

  // ==================== ESTADO DE CUENTA ====================
  const openEstadoCuenta = async (userId: string) => {
    setEstadoCuentaLoading(true)
    setEstadoCuentaOpen(true)
    try {
      const res = await fetch(`/api/credit/users/${userId}`)
      if (res.ok) {
        const data = await res.json()
        setEstadoCuentaUser(data)
      } else {
        toast.error("Error al cargar estado de cuenta")
        setEstadoCuentaOpen(false)
      }
    } catch {
      toast.error("Error de conexión")
      setEstadoCuentaOpen(false)
    } finally {
      setEstadoCuentaLoading(false)
    }
  }

  // ==================== DAR CRÉDITO ====================
  const searchUsersForCredit = async (query: string) => {
    if (query.length < 2) {
      setDarCreditoResults([])
      return
    }
    setDarCreditoSearching(true)
    try {
      const res = await fetch(`/api/users?search=${encodeURIComponent(query)}&role=CUSTOMER&limit=10`)
      const data = await res.json()
      setDarCreditoResults(data.users ?? [])
    } catch {
      setDarCreditoResults([])
    } finally {
      setDarCreditoSearching(false)
    }
  }

  const handleDarCredito = async () => {
    if (!darCreditoUser) return
    const limit = darCreditoLimit === "" ? null : parseFloat(darCreditoLimit)
    if (limit !== null && (isNaN(limit) || limit < 0)) {
      toast.error("Ingresa un límite válido (0 o mayor)")
      return
    }
    setDarCreditoLoading(true)
    try {
      const res = await fetch(`/api/credit/users/${darCreditoUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creditLimit: limit }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(
          limit === null
            ? `Línea de crédito removida para ${darCreditoUser.name}`
            : `Límite de crédito actualizado a ${formatPrice(limit)} para ${darCreditoUser.name}`
        )
        setDarCreditoOpen(false)
        setDarCreditoUser(null)
        setDarCreditoSearch("")
        setDarCreditoResults([])
        setDarCreditoLimit("")
        fetchData()
      } else {
        toast.error(data.error || "Error al actualizar crédito")
      }
    } catch {
      toast.error("Error de conexión")
    } finally {
      setDarCreditoLoading(false)
    }
  }

  // ==================== NUEVO CARGO ====================
  const searchUsersForCargo = async (query: string) => {
    if (query.length < 2) {
      setCargoResults([])
      return
    }
    setCargoSearching(true)
    try {
      const res = await fetch(`/api/users?search=${encodeURIComponent(query)}&role=CUSTOMER&limit=10`)
      const data = await res.json()
      // Solo mostrar usuarios con línea de crédito
      setCargoResults((data.users ?? []).filter((u: SearchUser) => u.creditLimit != null))
    } catch {
      setCargoResults([])
    } finally {
      setCargoSearching(false)
    }
  }

  const handleCargo = async () => {
    if (!cargoUser || !cargoAmount) return
    const amount = parseFloat(cargoAmount)
    if (isNaN(amount) || amount <= 0) {
      toast.error("Ingresa un monto válido mayor a 0")
      return
    }
    if (cargoLoading) return
    setCargoLoading(true)
    const payload = { userId: cargoUser.id, amount, notes: cargoNotes || undefined }
    debtOperation.current = getClientOperationKey(debtOperation.current, payload)
    try {
      const res = await fetch("/api/credit/debt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          idempotencyKey: debtOperation.current.key,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        debtOperation.current = null
        toast.success(`Cargo de ${formatPrice(amount)} registrado para ${cargoUser.name}`)
        setCargoOpen(false)
        setCargoUser(null)
        setCargoSearch("")
        setCargoResults([])
        setCargoAmount("")
        setCargoNotes("")
        fetchData()
      } else {
        toast.error(data.error || "Error al registrar cargo")
      }
    } catch {
      toast.error("Error de conexión")
    } finally {
      setCargoLoading(false)
    }
  }

  // ==================== RENDER ====================
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Módulo de Crédito y Cartera</h1>
          <p className="text-muted-foreground mt-1">
            Supervisa saldos deudores, abonos y estado de cuentas de tus clientes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDarCreditoOpen(true)} variant="outline" className="gap-2">
            <CreditCard className="h-4 w-4" />
            Dar Crédito
          </Button>
          <Button onClick={() => { setCargoOpen(true); setCargoUser(null); setCargoSearch(""); setCargoResults([]); setCargoAmount(""); setCargoNotes("") }} variant="outline" className="gap-2">
            <Plus className="h-4 w-4" />
            Nuevo Cargo
          </Button>
          <Button onClick={fetchData} variant="ghost" size="icon" title="Actualizar">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Tarjetas de Métricas */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total por Cobrar</CardTitle>
            <DollarSign className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatPrice(totalDebt)}</div>
            <p className="text-xs text-muted-foreground">Capital en la calle</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Clientes Deudores</CardTitle>
            <Users className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeClients}</div>
            <p className="text-xs text-muted-foreground">Con saldo mayor a $0</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Abonos del Mes</CardTitle>
            <Activity className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{formatPrice(monthPayments)}</div>
            <p className="text-xs text-muted-foreground">Recuperado este mes</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Tabla Deudores */}
        <Card>
          <CardHeader>
            <CardTitle>Cartera Activa</CardTitle>
            <CardDescription>Clientes que actualmente deben saldo</CardDescription>
          </CardHeader>
          <CardContent>
            {debtors.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No hay clientes con deuda pendiente.
              </p>
            ) : (
              <div className="space-y-4">
                {debtors.map((user) => {
                  const percentage = user.creditLimit
                    ? ((user.creditBalance ?? 0) / user.creditLimit) * 100
                    : 0
                  return (
                    <div
                      key={user.id}
                      className="flex flex-col gap-3 p-3 border rounded-lg bg-card hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm">{user.name}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Límite:{" "}
                            {user.creditLimit ? formatPrice(user.creditLimit) : "Sin límite"}
                          </p>
                          {user.creditLimit && user.creditLimit > 0 && (
                            <div className="w-full bg-secondary h-1.5 mt-2 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${
                                  percentage > 90
                                    ? "bg-destructive"
                                    : percentage > 75
                                      ? "bg-yellow-500"
                                      : "bg-primary"
                                }`}
                                style={{ width: `${Math.min(percentage, 100)}%` }}
                              />
                            </div>
                          )}
                        </div>
                        <p className="font-bold text-destructive ml-3">
                          {formatPrice(user.creditBalance || 0)}
                        </p>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <Button
                          size="sm"
                          variant="default"
                          className="gap-1.5 h-8 bg-green-600 hover:bg-green-700"
                          onClick={() => openAbonar(user)}
                        >
                          <Wallet className="h-3.5 w-3.5" />
                          Abonar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 h-8"
                          onClick={() => openEstadoCuenta(user.id)}
                        >
                          <FileText className="h-3.5 w-3.5" />
                          Estado de Cuenta
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tabla Movimientos */}
        <Card>
          <CardHeader>
            <CardTitle>Últimos Movimientos</CardTitle>
            <CardDescription>Registro de créditos y abonos recientes</CardDescription>
          </CardHeader>
          <CardContent>
            {movements.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No hay movimientos recientes.
              </p>
            ) : (
              <div className="space-y-3">
                {movements.map((mov) => {
                  const isDebt = mov.type === "DEBT"
                  return (
                    <div
                      key={mov.id}
                      className="flex items-center gap-3 p-3 border-b last:border-0 pb-3"
                    >
                      <div
                        className={`p-2 rounded-full ${
                          isDebt
                            ? "bg-destructive/10 text-destructive"
                            : "bg-green-500/10 text-green-500"
                        }`}
                      >
                        {isDebt ? (
                          <ArrowUpRight className="h-4 w-4" />
                        ) : (
                          <ArrowDownRight className="h-4 w-4" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between items-start">
                          <p className="text-sm font-semibold">{mov.user.name}</p>
                          <div className="text-right">
                            <p
                              className={`text-sm font-bold ${
                                isDebt ? "text-destructive" : "text-green-600"
                              }`}
                            >
                              {isDebt ? "+" : "-"}
                              {formatPrice(mov.amount)}
                            </p>
                            {mov.type === "PAYMENT" && (
                              <a
                                href={`/admin/tickets/abono/${mov.id}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[10px] text-blue-500 hover:underline"
                              >
                                Ver ticket
                              </a>
                            )}
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 flex justify-between">
                          <span>{creditMovementLabels[mov.type]}{mov.notes ? ` · ${mov.notes}` : ""}</span>
                          <span>{formatDate(mov.createdAt)}</span>
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ==================== MODAL: ABONAR ==================== */}
      <Dialog open={abonarOpen} onOpenChange={(open) => { if (!paymentInFlight.current) setAbonarOpen(open) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar Abono</DialogTitle>
            <DialogDescription>
              {abonarUser && (
                <>
                  Cliente: <strong>{abonarUser.name}</strong> — Deuda actual:{" "}
                  <strong className="text-destructive">
                    {formatPrice(abonarUser.creditBalance || 0)}
                  </strong>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Monto del Abono</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="Ej: 500"
                value={abonarAmount}
                disabled={abonarLoading}
                onChange={(e) => setAbonarAmount(e.target.value)}
                autoFocus
              />
              {abonarAmount &&
                abonarUser &&
                parseFloat(abonarAmount) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nuevo saldo:{" "}
                    {formatPrice(
                      Math.max(0, (abonarUser.creditBalance || 0) - parseFloat(abonarAmount))
                    )}
                  </p>
                )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="credit-payment-method">Medio de abono</Label>
              <Select
                value={abonarPaymentMethod}
                onValueChange={(value) => { if (!paymentInFlight.current) setAbonarPaymentMethod(value as "EFECTIVO" | "TARJETA" | "TRANSFERENCIA") }}
              >
                <SelectTrigger id="credit-payment-method" disabled={abonarLoading}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EFECTIVO">Efectivo</SelectItem>
                  <SelectItem value="TARJETA">Tarjeta</SelectItem>
                  <SelectItem value="TRANSFERENCIA">Transferencia</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {abonarPaymentMethod === "EFECTIVO"
                  ? "Efectivo: requiere caja abierta y registra una entrada de dinero."
                  : "Este abono reduce la deuda sin registrar efectivo en caja."}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Notas (opcional)</Label>
              <Textarea
                placeholder="Ej: Referencia o aclaración del abono"
                value={abonarNotes}
                disabled={abonarLoading}
                maxLength={500}
                onChange={(e) => setAbonarNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbonarOpen(false)} disabled={abonarLoading}>
              Cancelar
            </Button>
            <Button
              onClick={handleAbonar}
              disabled={abonarLoading || !abonarAmount || parseFloat(abonarAmount) <= 0}
              className="bg-green-600 hover:bg-green-700"
            >
              {abonarLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrar Abono
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== SHEET: ESTADO DE CUENTA ==================== */}
      <Sheet open={estadoCuentaOpen} onOpenChange={setEstadoCuentaOpen}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Estado de Cuenta</SheetTitle>
            <SheetDescription>
              {estadoCuentaUser
                ? `${estadoCuentaUser.name} — ${estadoCuentaUser.email || "Sin email"}`
                : "Cargando..."}
            </SheetDescription>
          </SheetHeader>
          {estadoCuentaLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : estadoCuentaUser ? (
            <div className="space-y-6 mt-6">
              {/* Resumen */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-destructive/10 rounded-lg text-center">
                  <p className="text-xs text-muted-foreground font-medium">Saldo Deudor</p>
                  <p className="text-xl font-bold text-destructive mt-1">
                    {formatPrice(estadoCuentaUser.creditBalance || 0)}
                  </p>
                </div>
                <div className="p-4 bg-primary/10 rounded-lg text-center">
                  <p className="text-xs text-muted-foreground font-medium">Límite</p>
                  <p className="text-xl font-bold mt-1">
                    {estadoCuentaUser.creditLimit != null
                      ? formatPrice(estadoCuentaUser.creditLimit)
                      : "Sin límite"}
                  </p>
                </div>
              </div>

              {/* Disponible */}
              {estadoCuentaUser.creditLimit != null && (
                <div className="p-3 bg-muted rounded-lg text-center">
                  <p className="text-xs text-muted-foreground">Crédito Disponible</p>
                  <p className="text-lg font-bold text-green-600">
                    {formatPrice(
                      Math.max(
                        0,
                        estadoCuentaUser.creditLimit - (estadoCuentaUser.creditBalance || 0)
                      )
                    )}
                  </p>
                </div>
              )}

              {/* Historial */}
              <div>
                <h3 className="font-semibold text-sm mb-3">
                  Historial de Movimientos (
                  {estadoCuentaUser.creditMovements?.length || 0})
                </h3>
                {!estadoCuentaUser.creditMovements ||
                estadoCuentaUser.creditMovements.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No hay movimientos registrados.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {estadoCuentaUser.creditMovements.map((mov) => {
                      const isDebt = mov.type === "DEBT"
                      return (
                        <div
                          key={mov.id}
                          className="flex items-center justify-between p-3 border rounded-lg text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className={`p-1.5 rounded-full ${
                                isDebt
                                  ? "bg-destructive/10 text-destructive"
                                  : "bg-green-500/10 text-green-500"
                              }`}
                            >
                              {isDebt ? (
                                <ArrowUpRight className="h-3 w-3" />
                              ) : (
                                <ArrowDownRight className="h-3 w-3" />
                              )}
                            </div>
                            <div>
                              <p className="font-medium">
                                {creditMovementLabels[mov.type]}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {mov.notes || (mov.referenceType || "-")}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p
                              className={`font-bold ${
                                isDebt ? "text-destructive" : "text-green-600"
                              }`}
                            >
                              {isDebt ? "+" : "-"}
                              {formatPrice(mov.amount)}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {formatDate(mov.createdAt)}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* ==================== MODAL: DAR CRÉDITO ==================== */}
      <Dialog
        open={darCreditoOpen}
        onOpenChange={(open) => {
          setDarCreditoOpen(open)
          if (!open) {
            setDarCreditoUser(null)
            setDarCreditoSearch("")
            setDarCreditoResults([])
            setDarCreditoLimit("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Asignar Línea de Crédito</DialogTitle>
            <DialogDescription>
              Busca un cliente y asigna o modifica su límite de crédito.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!darCreditoUser ? (
              <>
                <div className="space-y-2">
                  <Label>Buscar Cliente</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Nombre, teléfono o email..."
                      value={darCreditoSearch}
                      onChange={(e) => {
                        setDarCreditoSearch(e.target.value)
                        searchUsersForCredit(e.target.value)
                      }}
                      className="pl-9"
                      autoFocus
                    />
                    {darCreditoSearching && (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin" />
                    )}
                  </div>
                </div>
                {darCreditoResults.length > 0 && (
                  <div className="border rounded-lg max-h-48 overflow-y-auto">
                    {darCreditoResults.map((u) => (
                      <button
                        key={u.id}
                        className="w-full text-left p-3 hover:bg-muted border-b last:border-0 text-sm"
                        onClick={() => {
                          setDarCreditoUser(u)
                          setDarCreditoLimit(u.creditLimit?.toString() ?? "")
                        }}
                      >
                        <p className="font-medium">{u.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {u.phone || u.email || "Sin contacto"} •{" "}
                          {u.creditLimit != null
                            ? `Límite actual: ${formatPrice(u.creditLimit)}`
                            : "Sin crédito"}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="p-3 bg-muted rounded-lg">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-semibold">{darCreditoUser.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Saldo actual: {formatPrice(darCreditoUser.creditBalance || 0)} •{" "}
                        {darCreditoUser.creditLimit != null
                          ? `Límite: ${formatPrice(darCreditoUser.creditLimit)}`
                          : "Sin crédito asignado"}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDarCreditoUser(null)}
                    >
                      Cambiar
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Nuevo Límite de Crédito ($)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="100"
                    placeholder="Ej: 5000 (dejar vacío para remover)"
                    value={darCreditoLimit}
                    onChange={(e) => setDarCreditoLimit(e.target.value)}
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground">
                    Deja vacío para remover la línea de crédito del usuario.
                  </p>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDarCreditoOpen(false)}
              disabled={darCreditoLoading}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleDarCredito}
              disabled={darCreditoLoading || !darCreditoUser}
            >
              {darCreditoLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {darCreditoLimit === ""
                ? "Remover Crédito"
                : `Asignar ${formatPrice(parseFloat(darCreditoLimit) || 0)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== MODAL: NUEVO CARGO ==================== */}
      <Dialog
        open={cargoOpen}
        onOpenChange={(open) => {
          setCargoOpen(open)
          if (!open) {
            setCargoUser(null)
            setCargoSearch("")
            setCargoResults([])
            setCargoAmount("")
            setCargoNotes("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar Nuevo Cargo</DialogTitle>
            <DialogDescription>
              Agregar una deuda manual a la cuenta de crédito de un cliente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!cargoUser ? (
              <>
                <div className="space-y-2">
                  <Label>Buscar Cliente (con crédito)</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Nombre, teléfono o email..."
                      value={cargoSearch}
                      onChange={(e) => {
                        setCargoSearch(e.target.value)
                        searchUsersForCargo(e.target.value)
                      }}
                      className="pl-9"
                      autoFocus
                    />
                    {cargoSearching && (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin" />
                    )}
                  </div>
                </div>
                {cargoResults.length > 0 && (
                  <div className="border rounded-lg max-h-48 overflow-y-auto">
                    {cargoResults.map((u) => (
                      <button
                        key={u.id}
                        className="w-full text-left p-3 hover:bg-muted border-b last:border-0 text-sm"
                        onClick={() => setCargoUser(u)}
                      >
                        <p className="font-medium">{u.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Disponible:{" "}
                          {formatPrice(
                            Math.max(0, (u.creditLimit || 0) - (u.creditBalance || 0))
                          )}{" "}
                          de {formatPrice(u.creditLimit || 0)}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="p-3 bg-muted rounded-lg">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-semibold">{cargoUser.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Disponible:{" "}
                        {formatPrice(
                          Math.max(
                            0,
                            (cargoUser.creditLimit || 0) - (cargoUser.creditBalance || 0)
                          )
                        )}{" "}
                        de {formatPrice(cargoUser.creditLimit || 0)}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setCargoUser(null)}>
                      Cambiar
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Monto del Cargo</Label>
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="Ej: 1500"
                    value={cargoAmount}
                    onChange={(e) => setCargoAmount(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label>Descripción (opcional)</Label>
                  <Textarea
                    placeholder="Ej: Venta de refacciones, Servicio técnico..."
                    value={cargoNotes}
                    onChange={(e) => setCargoNotes(e.target.value)}
                    rows={2}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCargoOpen(false)}
              disabled={cargoLoading}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleCargo}
              disabled={cargoLoading || !cargoUser || !cargoAmount || parseFloat(cargoAmount) <= 0}
              variant="destructive"
            >
              {cargoLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrar Cargo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}