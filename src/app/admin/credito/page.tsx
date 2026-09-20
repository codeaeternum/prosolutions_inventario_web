"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Users,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  Loader2,
  FileText,
  Wallet,
  Search,
  RefreshCw,
  ChevronRight,
} from "lucide-react"
import { toast } from "sonner"
import { formatDate, formatPrice } from "@/lib/utils"
import { AbonarDialog, type AbonarTarget } from "@/components/clientes/abonar-dialog"
import { EstadoCuentaSheet } from "@/components/clientes/estado-cuenta"
import { creditMovementLabels, type CreditMovementItem } from "@/components/clientes/credit-utils"

interface DebtorUser {
  id: string
  name: string
  phone: string | null
  creditLimit: number | null
  creditBalance: number | null
}

interface CreditMovement extends CreditMovementItem {
  user: { name: string }
}

/**
 * Cobranza: cartera activa (quién debe y cuánto), abonos rápidos y últimos
 * movimientos. La gestión fina del cliente — historial completo, compras,
 * apartados y taller — vive en la ficha 360 (/admin/clientes/[id]).
 */
export default function CreditoPage() {
  const [loading, setLoading] = useState(true)
  const [totalDebt, setTotalDebt] = useState(0)
  const [activeClients, setActiveClients] = useState(0)
  const [monthPayments, setMonthPayments] = useState(0)
  const [debtors, setDebtors] = useState<DebtorUser[]>([])
  const [movements, setMovements] = useState<CreditMovement[]>([])

  const [search, setSearch] = useState("")
  const [abonarUser, setAbonarUser] = useState<AbonarTarget | null>(null)
  const [estadoCuentaUserId, setEstadoCuentaUserId] = useState<string | null>(null)

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
    // setTimeout evita setState síncrono dentro del effect (react-hooks/set-state-in-effect)
    const timer = setTimeout(() => void fetchData(), 0)
    return () => clearTimeout(timer)
  }, [fetchData])

  // Filtro local de la cartera (la API ya limita a los 20 mayores saldos).
  const filteredDebtors = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return debtors
    return debtors.filter(
      (d) => d.name.toLowerCase().includes(q) || (d.phone ?? "").includes(q)
    )
  }, [debtors, search])

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
          <h1 className="text-3xl font-bold tracking-tight">Crédito y Cobranza</h1>
          <p className="text-muted-foreground mt-1">
            Cartera activa, abonos y recuperación. La ficha completa de cada cliente está en Clientes 360.
          </p>
        </div>
        <Button onClick={fetchData} variant="ghost" size="icon" title="Actualizar">
          <RefreshCw className="h-4 w-4" />
        </Button>
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
        {/* Cartera activa */}
        <Card>
          <CardHeader>
            <CardTitle>Cartera Activa</CardTitle>
            <CardDescription>Clientes que actualmente deben saldo</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar deudor por nombre o teléfono..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Buscar deudor"
                className="pl-9"
              />
            </div>
            {filteredDebtors.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                {debtors.length === 0
                  ? "No hay clientes con deuda pendiente."
                  : "Ningún deudor coincide con la búsqueda."}
              </p>
            ) : (
              <div className="space-y-4">
                {filteredDebtors.map((user) => {
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
                          <Link
                            href={`/admin/clientes/${user.id}`}
                            className="font-semibold text-sm hover:underline inline-flex items-center gap-1"
                          >
                            {user.name}
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          </Link>
                          <p className="text-xs text-muted-foreground mt-1">
                            Límite: {user.creditLimit ? formatPrice(user.creditLimit) : "Sin límite"}
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
                          onClick={() => setAbonarUser(user)}
                        >
                          <Wallet className="h-3.5 w-3.5" />
                          Abonar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 h-8"
                          onClick={() => setEstadoCuentaUserId(user.id)}
                        >
                          <FileText className="h-3.5 w-3.5" />
                          Estado de Cuenta
                        </Button>
                        <Button size="sm" variant="ghost" className="gap-1.5 h-8" asChild>
                          <Link href={`/admin/clientes/${user.id}`}>Ver ficha 360</Link>
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Últimos movimientos */}
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
                          <span>
                            {creditMovementLabels[mov.type]}
                            {mov.notes ? ` · ${mov.notes}` : ""}
                          </span>
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

      {/* Diálogos compartidos con la ficha 360 */}
      <AbonarDialog
        open={abonarUser != null}
        onOpenChange={(open) => {
          if (!open) setAbonarUser(null)
        }}
        user={abonarUser}
        onSuccess={fetchData}
      />
      <EstadoCuentaSheet
        open={estadoCuentaUserId != null}
        onOpenChange={(open) => {
          if (!open) setEstadoCuentaUserId(null)
        }}
        userId={estadoCuentaUserId}
      />
    </div>
  )
}
