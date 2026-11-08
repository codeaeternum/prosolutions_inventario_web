"use client"

// Convenio B2B entre talleres asociados: cuentas internas por las órdenes
// espejo de la delegación. "Debo a talleres" = mis órdenes enviadas al
// reparador (pago el partnerPriceCents de la espejo); "Me deben captadores" =
// órdenes que otros negocios me trajeron. El cobro al cliente final NO está
// aquí — se cobra por POS como venta aparte.
// Vive como pestaña "Cuentas" dentro de /admin/mercado (la ruta vieja
// /admin/convenio redirige ahí).
import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CheckCircle2, Clock, Download, FileText, Handshake, Loader2, PackagePlus, Printer, RefreshCw, Search, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { BusinessName } from "@/components/admin/business-name"
import { useCurrency } from "@/components/currency-provider"
import { formatDate, formatDay } from "@/lib/utils"
import { repairLabels } from "@/lib/workshop-labels"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { buildConvenioStatement, convenioStatementCsv, convenioStatementFileName, countSettledWithin, type ConvenioStatement } from "@/lib/convenio-statement"

type ConvenioTotals = { pendingCents: number; settledCents: number; unpricedPending: number }
type AgingFields = { chargeableAt: string | null; daysPending: number | null }
type PagarRow = AgingFields & {
  orderId: string; folio: string; delegatedAt: string | null; convenioSettledAt: string | null
  convenioSettledAmountCents: number | null
  mirrorOrderId: string | null; mirrorFolio: string | null; partnerName: string | null
  mirrorStatus: string | null; partnerPriceCents: number | null; chargeable: boolean
}
type CobrarRow = AgingFields & {
  orderId: string; folio: string; createdAt: string; convenioSettledAt: string | null
  convenioSettledAmountCents: number | null
  originFolio: string | null; captorName: string | null; status: string
  // Captada de mostrador (partnerDrop): el aliado solo quedó como nombre en
  // texto — sin tenant ligado ni espejo. La fila lleva el badge "mostrador".
  walkIn: boolean
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

// Antigüedad de la cuenta pendiente: mismos tramos y paleta que la cartera
// de /admin/credito (verde → ámbar → naranja → destructive).
type AgingBucket = "0-7" | "8-15" | "16-30" | "30+"
const AGING_ORDER: readonly AgingBucket[] = ["0-7", "8-15", "16-30", "30+"]
const agingBucketOf = (days: number): AgingBucket =>
  days <= 7 ? "0-7" : days <= 15 ? "8-15" : days <= 30 ? "16-30" : "30+"
const agingBucketMeta: Record<AgingBucket, { label: string; className: string }> = {
  "0-7": { label: "0-7 días", className: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30" },
  "8-15": { label: "8-15 días", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30" },
  "16-30": { label: "16-30 días", className: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30" },
  "30+": { label: "+30 días", className: "bg-destructive/10 text-destructive border-destructive/30" },
}

// Impresión del estado de cuenta: la hoja va en un Dialog de Radix, que se
// monta por portal como hijo directo de <body>. Al imprimir se ocultan TODOS
// los demás hijos de body (el admin completo) y se quitan al diálogo sus
// restricciones de overlay (fixed/translate/scroll/max-w) — así la hoja sale
// sola desde el borde superior de la página. La regla solo existe mientras
// el diálogo está abierto (el <style> viaja dentro de él).
const STATEMENT_PRINT_CSS = `
@media print {
  body > *:not([data-slot="dialog-content"]) { display: none !important; }
  [data-slot="dialog-content"] {
    position: static !important;
    transform: none !important;
    translate: none !important;
    left: auto !important;
    top: auto !important;
    width: 100% !important;
    max-width: none !important;
    max-height: none !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    overflow: visible !important;
  }
  [data-slot="dialog-content"] > div {
    overflow: visible !important;
    max-height: none !important;
    padding-right: 0 !important;
  }
  [data-slot="dialog-content"] > button { display: none !important; }
}`

export function CuentasPanel() {
  const { formatPrice } = useCurrency()
  const [report, setReport] = useState<ConvenioReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  // Filtro por captador/taller: recorta client-side porCobrar (captorName) y
  // porPagar (partnerName) con el mismo texto.
  const [nameFilter, setNameFilter] = useState("")
  // Liquidación en lote (aliado que acumula y paga mensual): selección de
  // cuentas porCobrar pendientes exigibles, confirmación inline y el flag de
  // ingreso en caja para el pago en efectivo en ventanilla.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false)
  const [recordCashIn, setRecordCashIn] = useState(false)
  const [batchBusy, setBatchBusy] = useState(false)
  // Diálogo del estado de cuenta imprimible del aliado filtrado.
  const [statementOpen, setStatementOpen] = useState(false)
  const requestVersion = useRef(0)
  // Llave idempotente por (orden, estado destino) — o "batch" para el lote—:
  // un reintento tras fallo de red reusa la misma llave y el servidor
  // devuelve el resultado guardado.
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
      // La selección del lote se poda contra el reporte fresco: una cuenta que
      // ya no es exigible (o desapareció) no puede quedar marcada.
      setSelectedIds(previous => {
        if (previous.size === 0) return previous
        const selectable = new Set(
          ((data.porCobrar?.rows ?? []) as CobrarRow[])
            .filter(row => row.chargeable && !row.convenioSettledAt)
            .map(row => row.orderId),
        )
        const next = new Set([...previous].filter(id => selectable.has(id)))
        return next.size === previous.size ? previous : next
      })
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

  // Liquidación en lote (settleConvenioBatch): UN POST con todas las cuentas
  // seleccionadas del lado porCobrar. recordCashIn asienta un único
  // CashMovement IN por el total — el pago en efectivo del aliado en
  // ventanilla; por transferencia el flag queda apagado.
  const settleBatch = async (orderIds: string[], cash: boolean) => {
    if (batchBusy || orderIds.length === 0) return
    const op = getClientOperationKey(opKeys.current.get("batch") ?? null, { orderIds: [...orderIds].sort(), recordCashIn: cash })
    opKeys.current.set("batch", op)
    setBatchBusy(true)
    try {
      const response = await fetch("/api/convenio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds, settled: true, recordCashIn: cash, idempotencyKey: op.key }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) { toast.error(data.error || "No se pudo liquidar la selección"); return }
      const settledCount = Array.isArray(data.settled) ? data.settled.length : orderIds.length
      toast.success(`${settledCount} cuenta(s) liquidada(s) · ${money(data.totalCents ?? 0)}${cash ? " — ingreso registrado en caja" : ""}`)
      setSelectedIds(new Set())
      setBatchConfirmOpen(false)
      setRecordCashIn(false)
      await load()
    } catch {
      toast.error("Error de conexión")
    } finally {
      setBatchBusy(false)
    }
  }

  const money = (cents: number) => formatPrice(cents / 100)

  const statusBadge = (status: string | null) =>
    status
      ? <Badge className={statusBadgeClass[status] ?? fallbackBadgeClass}>{repairLabels[status as keyof typeof repairLabels] ?? status}</Badge>
      : <Badge variant="outline">Sin espejo</Badge>

  // La antigüedad solo se muestra en cuentas pendientes exigibles: saldada
  // ya no debe nada y "en proceso" todavía no es exigible.
  const cuentaBadge = (row: { convenioSettledAt: string | null; chargeable: boolean } & AgingFields) => {
    if (row.convenioSettledAt)
      return <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Pagada · {formatDate(row.convenioSettledAt)}</Badge>
    if (!row.chargeable) return <Badge variant="outline">En proceso</Badge>
    const bucket = row.daysPending != null ? agingBucketOf(row.daysPending) : null
    return (
      <div className="flex flex-col items-start gap-1">
        <Badge variant="secondary">Pendiente</Badge>
        {bucket && (
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${agingBucketMeta[bucket].className}`}
            title={row.chargeableAt ? `Exigible desde ${formatDay(row.chargeableAt)}` : undefined}
          >
            <Clock className="h-3 w-3" />
            {row.daysPending === 0 ? "Desde hoy" : `Hace ${row.daysPending} d`}
          </span>
        )}
      </div>
    )
  }

  // Chips-resumen por tramo de antigüedad (cuántas cuentas y cuánto dinero),
  // mismo formato que el resumen de cartera en /admin/credito.
  const agingChips = (rows: ({ convenioSettledAt: string | null; chargeable: boolean; partnerPriceCents: number | null } & AgingFields)[]) => {
    const acc = new Map<AgingBucket, { count: number; total: number }>()
    for (const row of rows) {
      if (row.convenioSettledAt || !row.chargeable || row.daysPending == null) continue
      const bucket = agingBucketOf(row.daysPending)
      const entry = acc.get(bucket) ?? { count: 0, total: 0 }
      entry.count += 1
      entry.total += row.partnerPriceCents ?? 0
      acc.set(bucket, entry)
    }
    if (acc.size === 0) return null
    return (
      <div className="flex flex-wrap gap-2">
        {AGING_ORDER.filter(b => acc.has(b)).map(b => (
          <span
            key={b}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${agingBucketMeta[b].className}`}
          >
            {agingBucketMeta[b].label}: {acc.get(b)!.count} · {money(acc.get(b)!.total)}
          </span>
        ))}
      </div>
    )
  }

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

  // Precio convenio de la fila: una cuenta ya saldada muestra el monto
  // congelado al liquidar (snapshot), no el precio vigente hoy.
  const priceCell = (row: { convenioSettledAt: string | null; convenioSettledAmountCents: number | null; partnerPriceCents: number | null }) =>
    row.convenioSettledAt && row.convenioSettledAmountCents != null
      ? <span title="Monto congelado al liquidar la cuenta">{money(row.convenioSettledAmountCents)}</span>
      : row.partnerPriceCents != null
        ? money(row.partnerPriceCents)
        : <span className="text-amber-600 dark:text-amber-400 text-xs">Sin precio convenio</span>

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

  // El mismo texto filtra porCobrar por captorName y porPagar por
  // partnerName — un aliado puede aparecer en ambas caras del convenio.
  const filterText = nameFilter.trim().toLowerCase()
  const matchesName = (name: string | null) => (name ?? "").toLowerCase().includes(filterText)
  const visibleCobrarRows = filterText ? porCobrar.rows.filter(row => matchesName(row.captorName)) : porCobrar.rows
  const visiblePagarRows = filterText ? porPagar.rows.filter(row => matchesName(row.partnerName)) : porPagar.rows
  // Subtotal pendiente del filtro activo, agrupado por captador ("Telcel
  // Centro: 3 órdenes · $1,240"): solo cuentas exigibles sin saldar.
  const filterSubtotals = new Map<string, { count: number; cents: number }>()
  if (filterText) {
    for (const row of visibleCobrarRows) {
      if (!row.chargeable || row.convenioSettledAt) continue
      const entry = filterSubtotals.get(row.captorName ?? "Sin captador") ?? { count: 0, cents: 0 }
      entry.count += 1
      entry.cents += row.partnerPriceCents ?? 0
      filterSubtotals.set(row.captorName ?? "Sin captador", entry)
    }
  }

  // Estado de cuenta del aliado: el documento lleva UN solo nombre, así que
  // solo se ofrece cuando el filtro resuelve a un único captador entre las
  // filas visibles; con varios nombres coincidentes se pide afinar el filtro.
  const statementAllyNames = new Set(visibleCobrarRows.map(row => row.captorName ?? "Sin captador"))
  const statement: ConvenioStatement | null =
    filterText && visibleCobrarRows.length > 0 && statementAllyNames.size === 1
      ? buildConvenioStatement(visibleCobrarRows, [...statementAllyNames][0])
      : null
  const downloadStatementCsv = () => {
    if (!statement) return
    const blob = new Blob([convenioStatementCsv(statement)], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = convenioStatementFileName(statement.allyName, new Date(statement.issuedAt))
    link.click()
    URL.revokeObjectURL(url)
  }

  // Vida tras liquidar todo: si ya no hay deuda exigible pero hubo cobros o
  // pagos recientes, el aviso con su conteo evita un panel "muerto".
  const cobrarPendingCount = porCobrar.rows.filter(row => row.chargeable && !row.convenioSettledAt).length
  const pagarPendingCount = porPagar.rows.filter(row => row.chargeable && !row.convenioSettledAt).length
  const cobrarSettledRecent = countSettledWithin(porCobrar.rows)
  const pagarSettledRecent = countSettledWithin(porPagar.rows)

  // Selección del lote: solo cuentas porCobrar pendientes y exigibles — una
  // saldada o aún en proceso no forma parte de una liquidación.
  const selectableRows = visibleCobrarRows.filter(row => row.chargeable && !row.convenioSettledAt)
  const selectedRows = selectableRows.filter(row => selectedIds.has(row.orderId))
  const selectedTotalCents = selectedRows.reduce((sum, row) => sum + (row.partnerPriceCents ?? 0), 0)
  const allSelected = selectableRows.length > 0 && selectableRows.every(row => selectedIds.has(row.orderId))
  const someSelected = selectableRows.some(row => selectedIds.has(row.orderId))
  const toggleRowSelected = (orderId: string, checked: boolean) => {
    setSelectedIds(previous => {
      const next = new Set(previous)
      if (checked) next.add(orderId)
      else next.delete(orderId)
      return next
    })
  }
  const toggleAllSelected = (checked: boolean) => {
    setSelectedIds(previous => {
      const next = new Set(previous)
      for (const row of selectableRows) {
        if (checked) next.add(row.orderId)
        else next.delete(row.orderId)
      }
      return next
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Handshake className="h-5 w-5" />
            Convenio con talleres
          </h2>
          <p className="text-sm text-muted-foreground">
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

      {/* Filtro por nombre de aliado: recorta las dos tablas (porCobrar por
          captorName, porPagar por partnerName). Debajo va el subtotal
          pendiente de lo filtrado. */}
      <div className="space-y-1.5">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={nameFilter}
            onChange={event => setNameFilter(event.target.value)}
            placeholder="Filtrar por captador o taller…"
            aria-label="Filtrar por captador o taller"
            maxLength={80}
            className="pl-8"
          />
        </div>
        {filterText && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {filterSubtotals.size > 0
                ? [...filterSubtotals.entries()].map(([name, sub]) => `${name}: ${sub.count} ${sub.count === 1 ? "orden" : "órdenes"} · ${money(sub.cents)}`).join("   ·   ")
                : "Sin cuentas pendientes con este filtro."}
            </p>
            {/* Cobro al aliado: estado de cuenta imprimible y CSV. Solo ADMIN
                (canSettle) — es el documento con el que se le cobra al aliado. */}
            {report?.canSettle && visibleCobrarRows.length > 0 && (
              statement ? (
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setStatementOpen(true)}>
                    <FileText className="mr-1.5 h-3.5 w-3.5" />
                    Estado de cuenta
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={downloadStatementCsv}>
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    CSV
                  </Button>
                </div>
              ) : statementAllyNames.size > 1 ? (
                <p className="text-xs text-muted-foreground">
                  El estado de cuenta es por aliado: afina el filtro a un solo captador.
                </p>
              ) : null
            )}
          </div>
        )}
      </div>

      {/* Debo a talleres (lado captador) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowUpRight className="h-5 w-5 text-rose-500 dark:text-rose-400" />
            Debo a talleres
          </CardTitle>
          <CardDescription>Órdenes que envié a un taller asociado; debo el precio convenio al reparador</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {porPagar.rows.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <p className="text-sm font-medium">Sin deuda con talleres asociados</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Cuando delegues una reparación a un taller asociado, lo que le debes por el precio convenio aparecerá aquí.
                La delegación se hace desde la ficha de la orden en el taller.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-4">
                <Link href="/admin/taller">
                  <Wrench className="mr-2 h-4 w-4" />
                  Ir al taller
                </Link>
              </Button>
            </div>
          ) : visiblePagarRows.length === 0 ? (
            <p className="text-muted-foreground text-sm">Ninguna cuenta coincide con el filtro.</p>
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
                  {visiblePagarRows.map(row => (
                    <TableRow key={row.orderId}>
                      <TableCell className="font-medium">{row.folio}</TableCell>
                      <TableCell>{row.partnerName ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span>{row.mirrorFolio ?? "—"}</span>
                          {statusBadge(row.mirrorStatus)}
                        </div>
                      </TableCell>
                      <TableCell>{priceCell(row)}</TableCell>
                      <TableCell>{cuentaBadge(row)}</TableCell>
                      {report?.canSettle && <TableCell className="text-right">{settleButton(row)}</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {/* Tras liquidar toda la deuda el panel sigue vivo: conteo de lo
              saldado en los últimos 30 días. */}
          {pagarPendingCount === 0 && pagarSettledRecent > 0 && (
            <p className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Sin deuda pendiente con talleres — {pagarSettledRecent} {pagarSettledRecent === 1 ? "cuenta saldada" : "cuentas saldadas"} en los últimos 30 días.
            </p>
          )}
          {agingChips(porPagar.rows)}
          {totalsFooter(porPagar.totals, "Pendiente por pagar")}
        </CardContent>
      </Card>

      {/* Me deben captadores (lado reparador) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowDownLeft className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            Me deben captadores
          </CardTitle>
          <CardDescription>Órdenes que negocios asociados me trajeron; me deben el precio convenio</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {porCobrar.rows.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <p className="text-sm font-medium">Aún no hay cuentas de aliados</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Cuando un taller o negocio aliado te traiga equipos para reparar, lo que te debe por el precio convenio
                aparecerá aquí — se cobra por orden o en lote a fin de mes.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-4">
                <Link href="/admin/taller/recibir">
                  <PackagePlus className="mr-2 h-4 w-4" />
                  Registrar una orden traída por aliado
                </Link>
              </Button>
            </div>
          ) : visibleCobrarRows.length === 0 ? (
            <p className="text-muted-foreground text-sm">Ninguna cuenta coincide con el filtro.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {report?.canSettle && (
                      <TableHead className="w-10">
                        <Checkbox
                          aria-label="Seleccionar todas las cuentas pendientes"
                          checked={allSelected ? true : someSelected ? "indeterminate" : false}
                          disabled={selectableRows.length === 0 || batchBusy}
                          onCheckedChange={checked => toggleAllSelected(checked === true)}
                        />
                      </TableHead>
                    )}
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
                  {visibleCobrarRows.map(row => (
                    <TableRow key={row.orderId}>
                      {report?.canSettle && (
                        <TableCell>
                          <Checkbox
                            aria-label={`Seleccionar la cuenta de la orden ${row.folio}`}
                            checked={selectedIds.has(row.orderId)}
                            disabled={!row.chargeable || Boolean(row.convenioSettledAt) || batchBusy}
                            onCheckedChange={checked => toggleRowSelected(row.orderId, checked === true)}
                          />
                        </TableCell>
                      )}
                      <TableCell className="font-medium">{row.folio}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5">
                          {row.captorName ?? "—"}
                          {/* Alta de mostrador (partnerDrop): el aliado no tiene
                              cuenta ligada — solo su nombre en texto. */}
                          {row.walkIn && (
                            <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground">
                              mostrador
                            </Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>{row.originFolio ?? "—"}</TableCell>
                      <TableCell>{statusBadge(row.status)}</TableCell>
                      <TableCell>{priceCell(row)}</TableCell>
                      <TableCell>{cuentaBadge(row)}</TableCell>
                      {report?.canSettle && <TableCell className="text-right">{settleButton(row)}</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {/* Liquidación en lote: para el aliado que acumula equipos y paga
              mensual. La confirmación inline muestra el total y permite
              asentar el ingreso en caja cuando paga en efectivo. */}
          {report?.canSettle && selectedRows.length > 0 && (
            <div className="rounded-lg border border-emerald-300/70 bg-emerald-50/60 p-3 dark:border-emerald-800 dark:bg-emerald-950/30">
              {batchConfirmOpen ? (
                <div className="space-y-3">
                  <p className="text-sm">
                    Se marcarán <strong>{selectedRows.length}</strong> {selectedRows.length === 1 ? "cuenta" : "cuentas"} como pagadas por un total de <strong>{money(selectedTotalCents)}</strong>.
                  </p>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={recordCashIn} disabled={batchBusy} onCheckedChange={checked => setRecordCashIn(checked === true)} />
                    Registrar ingreso en caja
                    <span className="text-xs text-muted-foreground">(el aliado paga en efectivo en ventanilla)</span>
                  </label>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={batchBusy} onClick={() => void settleBatch(selectedRows.map(row => row.orderId), recordCashIn)}>
                      {batchBusy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                      Confirmar liquidación
                    </Button>
                    <Button size="sm" variant="outline" disabled={batchBusy} onClick={() => { setBatchConfirmOpen(false); setRecordCashIn(false) }}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    {selectedRows.length} {selectedRows.length === 1 ? "cuenta seleccionada" : "cuentas seleccionadas"}
                  </p>
                  <Button size="sm" onClick={() => setBatchConfirmOpen(true)}>
                    Liquidar seleccionadas ({selectedRows.length} · {money(selectedTotalCents)})
                  </Button>
                </div>
              )}
            </div>
          )}
          {cobrarPendingCount === 0 && cobrarSettledRecent > 0 && (
            <p className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Todo cobrado — {cobrarSettledRecent} {cobrarSettledRecent === 1 ? "cuenta saldada" : "cuentas saldadas"} en los últimos 30 días.
            </p>
          )}
          {agingChips(porCobrar.rows)}
          {totalsFooter(porCobrar.totals, "Pendiente por cobrar")}
        </CardContent>
      </Card>

      {/* Estado de cuenta imprimible del aliado filtrado: el documento que se
          le entrega a fin de mes para cobrarle. El chrome del diálogo queda
          fuera de la impresión (print:hidden) y STATEMENT_PRINT_CSS deja solo
          la hoja en la página impresa. */}
      <Dialog open={statementOpen && Boolean(statement)} onOpenChange={setStatementOpen}>
        <DialogContent className="sm:max-w-3xl">
          {statementOpen && <style>{STATEMENT_PRINT_CSS}</style>}
          <DialogHeader className="print:hidden">
            <DialogTitle>Estado de cuenta{statement ? ` — ${statement.allyName}` : ""}</DialogTitle>
            <DialogDescription>
              Pendientes y saldadas del convenio con el aliado, listo para imprimir o exportar.
            </DialogDescription>
          </DialogHeader>
          {statement && (
            <div className="rounded-lg border bg-white p-6 text-zinc-900 shadow-sm print:border-0 print:shadow-none">
              {/* Encabezado del documento: negocio emisor + fecha de emisión */}
              <div className="flex items-start justify-between gap-4 border-b border-zinc-300 pb-4">
                <div>
                  <p className="text-lg font-bold leading-tight"><BusinessName /></p>
                  <p className="text-sm text-zinc-500">Estado de cuenta · Convenio de talleres aliados</p>
                </div>
                <div className="text-right text-sm">
                  <p className="text-zinc-500">Emitido</p>
                  <p className="font-medium">{formatDay(statement.issuedAt)}</p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Aliado</p>
                  <p className="text-xl font-semibold">{statement.allyName}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Total pendiente</p>
                  <p className="text-xl font-bold">{money(statement.totalPendingCents)}</p>
                </div>
              </div>

              {/* Deuda exigible: lo que se cobra en esta visita */}
              <section className="mt-5">
                <h3 className="text-sm font-semibold">Órdenes pendientes de pago ({statement.pending.length})</h3>
                {statement.pending.length === 0 ? (
                  <p className="mt-2 text-sm text-zinc-500">Sin saldo pendiente — todo cobrado o aún en proceso.</p>
                ) : (
                  <>
                    <table className="mt-2 w-full text-sm">
                      <thead>
                        <tr className="border-b border-zinc-300 text-left text-xs uppercase tracking-wide text-zinc-500">
                          <th className="py-1.5 pr-3 font-medium">Folio</th>
                          <th className="py-1.5 pr-3 font-medium">Recibida</th>
                          <th className="py-1.5 pr-3 font-medium">Exigible</th>
                          <th className="py-1.5 pr-3 text-right font-medium">Días</th>
                          <th className="py-1.5 text-right font-medium">Convenio</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statement.pending.map(entry => (
                          <tr key={entry.folio} className="border-b border-zinc-100">
                            <td className="py-1.5 pr-3 font-medium">{entry.folio}</td>
                            <td className="py-1.5 pr-3">{formatDay(entry.receivedAt)}</td>
                            <td className="py-1.5 pr-3">{entry.chargeableAt ? formatDay(entry.chargeableAt) : "—"}</td>
                            <td className="py-1.5 pr-3 text-right">{entry.daysPending ?? "—"}</td>
                            <td className="py-1.5 text-right">{entry.amountCents != null ? money(entry.amountCents) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={4} className="pt-2 text-right font-semibold">Total pendiente</td>
                          <td className="pt-2 text-right font-bold">{money(statement.totalPendingCents)}</td>
                        </tr>
                      </tfoot>
                    </table>
                    {statement.unpricedPending > 0 && (
                      <p className="mt-1.5 text-xs text-amber-700">
                        {statement.unpricedPending} {statement.unpricedPending === 1 ? "orden sin" : "órdenes sin"} precio convenio — confirma el monto antes de cobrar.
                      </p>
                    )}
                  </>
                )}
              </section>

              {/* Aún no exigibles: referencia para el aliado, no son deuda. */}
              {statement.inProcess.length > 0 && (
                <section className="mt-5">
                  <h3 className="text-sm font-semibold text-zinc-600">En proceso — aún no exigibles ({statement.inProcess.length})</h3>
                  <table className="mt-2 w-full text-sm text-zinc-600">
                    <thead>
                      <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400">
                        <th className="py-1.5 pr-3 font-medium">Folio</th>
                        <th className="py-1.5 pr-3 font-medium">Recibida</th>
                        <th className="py-1.5 pr-3 font-medium">Trabajo</th>
                        <th className="py-1.5 text-right font-medium">Convenio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statement.inProcess.map(entry => (
                        <tr key={entry.folio} className="border-b border-zinc-100">
                          <td className="py-1.5 pr-3 font-medium">{entry.folio}</td>
                          <td className="py-1.5 pr-3">{formatDay(entry.receivedAt)}</td>
                          <td className="py-1.5 pr-3">
                            {entry.repairStatus ? repairLabels[entry.repairStatus as keyof typeof repairLabels] ?? entry.repairStatus : "—"}
                          </td>
                          <td className="py-1.5 text-right">{entry.amountCents != null ? money(entry.amountCents) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {/* Historial del periodo: lo ya pagado por el aliado. */}
              {statement.settled.length > 0 && (
                <section className="mt-5">
                  <h3 className="text-sm font-semibold text-zinc-600">Saldadas ({statement.settled.length})</h3>
                  <table className="mt-2 w-full text-sm text-zinc-600">
                    <thead>
                      <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400">
                        <th className="py-1.5 pr-3 font-medium">Folio</th>
                        <th className="py-1.5 pr-3 font-medium">Recibida</th>
                        <th className="py-1.5 pr-3 font-medium">Pagada</th>
                        <th className="py-1.5 text-right font-medium">Convenio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statement.settled.map(entry => (
                        <tr key={entry.folio} className="border-b border-zinc-100">
                          <td className="py-1.5 pr-3 font-medium">{entry.folio}</td>
                          <td className="py-1.5 pr-3">{formatDay(entry.receivedAt)}</td>
                          <td className="py-1.5 pr-3">{entry.settledAt ? formatDay(entry.settledAt) : "—"}</td>
                          <td className="py-1.5 text-right">{entry.amountCents != null ? money(entry.amountCents) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={3} className="pt-2 text-right font-semibold">Total saldado</td>
                        <td className="pt-2 text-right font-bold">{money(statement.totalSettledCents)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </section>
              )}

              <p className="mt-6 border-t border-zinc-200 pt-3 text-xs text-zinc-400">
                Documento interno del convenio entre negocios asociados — no es factura ni comprobante fiscal.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2 print:hidden sm:gap-0">
            <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!statement}>
              <Printer className="mr-2 h-4 w-4" />
              Imprimir
            </Button>
            <Button variant="outline" size="sm" onClick={downloadStatementCsv} disabled={!statement}>
              <Download className="mr-2 h-4 w-4" />
              CSV
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setStatementOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
