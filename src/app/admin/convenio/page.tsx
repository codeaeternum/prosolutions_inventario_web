"use client"

// Convenio B2B entre talleres asociados: cuentas internas por las órdenes
// espejo de la delegación. "Debo a talleres" = mis órdenes enviadas al
// reparador (pago el partnerPriceCents de la espejo); "Me deben captadores" =
// órdenes que otros negocios me trajeron. El cobro al cliente final NO está
// aquí — se cobra por POS como venta aparte.
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Handshake, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useCurrency } from "@/components/currency-provider"
import { formatDate } from "@/lib/utils"
import { repairLabels } from "@/lib/workshop-labels"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"

type ConvenioTotals = { pendingCents: number; settledCents: number; unpricedPending: number }
type PagarRow = {
  orderId: string; folio: string; delegatedAt: string | null; convenioSettledAt: string | null
  mirrorOrderId: string | null; mirrorFolio: string | null; partnerName: string | null
  mirrorStatus: string | null; partnerPriceCents: number | null; chargeable: boolean
}
type CobrarRow = {
  orderId: string; folio: string; createdAt: string; convenioSettledAt: string | null
  originFolio: string | null; captorName: string | null; status: string
  partnerPriceCents: number | null; chargeable: boolean
}
type ConvenioReport = {
  generatedAt: string
  canSettle: boolean
  porPagar: { rows: PagarRow[]; totals: ConvenioTotals }
  porCobrar: { rows: CobrarRow[]; totals: ConvenioTotals }
}

// Misma paleta de etapas que /admin/taller y /aliado.
const statusBadgeClass: Record<string, string> = {
  RECEIVED: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  DIAGNOSIS: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  WAITING_APPROVAL: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  WAITING_PARTS: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
  IN_REPAIR: "bg-blue-600/10 text-blue-700 dark:text-blue-300",
  QUALITY_CHECK: "bg-teal-500/10 text-teal-700 dark:text-teal-300",
  READY: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  DELIVERED: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  CANCELLED: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  NOT_REPAIRED: "bg-red-500/10 text-red-700 dark:text-red-300",
  NOT_AUTHORIZED: "bg-pink-500/10 text-pink-700 dark:text-pink-300",
  EXTERNAL_LAB: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  WARRANTY: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
}
const fallbackBadgeClass = "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400"

export default function ConvenioPage() {
  const { formatPrice } = useCurrency()
  const [report, setReport] = useState<ConvenioReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const requestVersion = useRef(0)
  // Llave idempotente por (orden, estado destino): un reintento tras fallo de
  // red reusa la misma llave y el servidor devuelve el resultado guardado.
  const opKeys = useRef(new Map<string, ClientOperationKey>())

  const load = useCallback(async () => {
    const version = ++requestVersion.current
    setLoading(true)
    setError("")
    try {
      const response = await fetch("/api/convenio")
      const data = await response.json().catch(() => ({}))
      if (version !== requestVersion.current) return
      if (!response.ok) { setError(data.error || "No se pudo cargar el convenio"); return }
      setReport(data)
    } catch {
      if (version !== requestVersion.current) return
      setError("No se pudo cargar el convenio")
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => { void load() }, 0)
    return () => clearTimeout(timer)
  }, [load])

  const toggleSettled = async (orderId: string, settled: boolean) => {
    if (busyId) return
    const slot = `${orderId}:${settled}`
    const op = getClientOperationKey(opKeys.current.get(slot) ?? null, { orderId, settled })
    opKeys.current.set(slot, op)
    setBusyId(orderId)
    try {
      const response = await fetch("/api/convenio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, settled, idempotencyKey: op.key }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) { toast.error(data.error || "No se pudo actualizar la cuenta"); return }
      toast.success(settled ? "Cuenta marcada como pagada" : "Cuenta reabierta como pendiente")
      await load()
    } catch {
      toast.error("Error de conexión")
    } finally {
      setBusyId(null)
    }
  }

  const money = (cents: number) => formatPrice(cents / 100)

  const statusBadge = (status: string | null) =>
    status
      ? <Badge className={statusBadgeClass[status] ?? fallbackBadgeClass}>{repairLabels[status as keyof typeof repairLabels] ?? status}</Badge>
      : <Badge variant="outline">Sin espejo</Badge>

  const cuentaBadge = (row: { convenioSettledAt: string | null; chargeable: boolean }) =>
    row.convenioSettledAt
      ? <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Pagada · {formatDate(row.convenioSettledAt)}</Badge>
      : row.chargeable
        ? <Badge variant="secondary">Pendiente</Badge>
        : <Badge variant="outline">En proceso</Badge>

  const settleButton = (row: { orderId: string; convenioSettledAt: string | null }) => (
    <Button
      variant="outline"
      size="sm"
      disabled={busyId === row.orderId}
      onClick={() => void toggleSettled(row.orderId, !row.convenioSettledAt)}
    >
      {busyId === row.orderId && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
      {row.convenioSettledAt ? "Marcar pendiente" : "Marcar pagada"}
    </Button>
  )

  const totalsFooter = (totals: ConvenioTotals, pendienteLabel: string) => (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t pt-3 text-sm">
      <span className="font-medium">{pendienteLabel}: <strong>{money(totals.pendingCents)}</strong></span>
      <span className="text-muted-foreground">Ya saldado: {money(totals.settledCents)}</span>
      {totals.unpricedPending > 0 && (
        <span className="text-amber-600 dark:text-amber-400">{totals.unpricedPending} sin precio convenio</span>
      )}
    </div>
  )

  if (loading && !report) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error && !report) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <AlertTriangle className="h-12 w-12 text-destructive" />
        <p className="text-destructive">{error}</p>
        <Button onClick={() => void load()} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Reintentar
        </Button>
      </div>
    )
  }

  const porPagar = report?.porPagar ?? { rows: [], totals: { pendingCents: 0, settledCents: 0, unpricedPending: 0 } }
  const porCobrar = report?.porCobrar ?? { rows: [], totals: { pendingCents: 0, settledCents: 0, unpricedPending: 0 } }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Handshake className="h-7 w-7" />
            Convenio con talleres
          </h1>
          <p className="text-muted-foreground">
            Cuentas internas entre negocios asociados por órdenes delegadas
          </p>
        </div>
        <Button onClick={() => void load()} variant="outline" size="sm" disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      <p className="text-sm text-muted-foreground border rounded-lg p-3 bg-muted/40">
        Estas cantidades son el precio convenio entre talleres (lo que un
        negocio cobra al otro), no el cobro al cliente final — eso se registra
        aparte en el punto de venta. Cada negocio marca su propia cuenta como
        pagada; el otro taller ve la suya de forma independiente.
      </p>

      {/* Debo a talleres (lado captador) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowUpRight className="h-5 w-5 text-rose-500" />
            Debo a talleres
          </CardTitle>
          <CardDescription>Órdenes que envié a un taller asociado; debo el precio convenio al reparador</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {porPagar.rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">No has delegado órdenes a talleres asociados.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mi orden</TableHead>
                    <TableHead>Taller</TableHead>
                    <TableHead>Orden espejo</TableHead>
                    <TableHead>Precio convenio</TableHead>
                    <TableHead>Cuenta</TableHead>
                    {report?.canSettle && <TableHead className="text-right">Acción</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porPagar.rows.map(row => (
                    <TableRow key={row.orderId}>
                      <TableCell className="font-medium">{row.folio}</TableCell>
                      <TableCell>{row.partnerName ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span>{row.mirrorFolio ?? "—"}</span>
                          {statusBadge(row.mirrorStatus)}
                        </div>
                      </TableCell>
                      <TableCell>
                        {row.partnerPriceCents != null
                          ? money(row.partnerPriceCents)
                          : <span className="text-amber-600 dark:text-amber-400 text-xs">Sin precio convenio</span>}
                      </TableCell>
                      <TableCell>{cuentaBadge(row)}</TableCell>
                      {report?.canSettle && <TableCell className="text-right">{settleButton(row)}</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {totalsFooter(porPagar.totals, "Pendiente por pagar")}
        </CardContent>
      </Card>

      {/* Me deben captadores (lado reparador) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowDownLeft className="h-5 w-5 text-emerald-600" />
            Me deben captadores
          </CardTitle>
          <CardDescription>Órdenes que negocios asociados me trajeron; me deben el precio convenio</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {porCobrar.rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">Ningún negocio asociado te ha traído órdenes.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mi orden</TableHead>
                    <TableHead>Captador</TableHead>
                    <TableHead>Orden origen</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Precio convenio</TableHead>
                    <TableHead>Cuenta</TableHead>
                    {report?.canSettle && <TableHead className="text-right">Acción</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porCobrar.rows.map(row => (
                    <TableRow key={row.orderId}>
                      <TableCell className="font-medium">{row.folio}</TableCell>
                      <TableCell>{row.captorName ?? "—"}</TableCell>
                      <TableCell>{row.originFolio ?? "—"}</TableCell>
                      <TableCell>{statusBadge(row.status)}</TableCell>
                      <TableCell>
                        {row.partnerPriceCents != null
                          ? money(row.partnerPriceCents)
                          : <span className="text-amber-600 dark:text-amber-400 text-xs">Sin precio convenio</span>}
                      </TableCell>
                      <TableCell>{cuentaBadge(row)}</TableCell>
                      {report?.canSettle && <TableCell className="text-right">{settleButton(row)}</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {totalsFooter(porCobrar.totals, "Pendiente por cobrar")}
        </CardContent>
      </Card>
    </div>
  )
}
