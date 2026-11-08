"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Banknote, Download, RefreshCw, Search, Settings2, ShieldAlert } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { csvCell } from "@/lib/csv"
import { formatPrice } from "@/lib/utils"

interface NominaEmployee {
  userId: string
  name: string
  jobTitle: string | null
  payType: string
  payRateCents: number | null
  commissionPct: number | null
  daysActive: number
  minutesActive: number
  salesTotalCents: number
  salesCount: number
  estimatedCents: number
  breakdown: {
    hourly?: { hours: number; rateCents: number }
    salary?: { rateCents: number; daysInPeriod: number; dailyRateCents: number }
    commission?: { pct: number; baseCents: number }
  }
}

const PAY_TYPE_LABELS: Record<string, string> = {
  NONE: "Sin esquema",
  HOURLY: "Por hora",
  SALARY: "Quincenal",
  COMMISSION: "Comisión",
}

// Las llaves de día "YYYY-MM-DD" se calculan en la zona del negocio para que
// "quincena actual" o "mes actual" coincidan con el reporte del servidor.
const mxDayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" })

const shiftDayKey = (key: string, days: number) => {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

type Preset = "14d" | "30d" | "mes" | "quincena"

const rangeFor = (preset: Preset): { from: string; to: string } => {
  const today = mxDayKey(new Date())
  switch (preset) {
    case "30d":
      return { from: shiftDayKey(today, -30), to: today }
    case "mes":
      return { from: `${today.slice(0, 7)}-01`, to: today }
    case "quincena": {
      // Quincena calendario: 1-15 o 16-fin del mes en curso, hasta hoy.
      const day = Number(today.slice(8, 10))
      return { from: `${today.slice(0, 7)}-${day <= 15 ? "01" : "16"}`, to: today }
    }
    default:
      return { from: shiftDayKey(today, -14), to: today }
  }
}

/** Diálogo para fijar el esquema de pago del empleado (PATCH /api/users/[id]). */
function PayConfigDialog({ employee, open, onClose, onSaved }: {
  employee: NominaEmployee | null
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [payType, setPayType] = useState(employee?.payType ?? "NONE")
  const [amount, setAmount] = useState(() =>
    !employee
      ? ""
      : employee.payType === "COMMISSION"
        ? String(employee.commissionPct ?? "")
        : employee.payRateCents != null
          ? String(employee.payRateCents / 100)
          : ""
  )
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!employee) return
    const num = Number(amount)
    const payload: Record<string, unknown> = { payType }
    if (payType === "COMMISSION") {
      if (!(num >= 0 && num <= 100)) return toast.error("La comisión debe estar entre 0 y 100%")
      payload.commissionPct = num
      payload.payRateCents = null
    } else if (payType === "NONE") {
      payload.payRateCents = null
      payload.commissionPct = null
    } else {
      if (!(num > 0)) return toast.error("Indica un monto válido")
      payload.payRateCents = Math.round(num * 100)
      payload.commissionPct = null
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/users/${employee.userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error()
      toast.success(`Esquema de ${employee.name} actualizado`)
      onClose()
      onSaved()
    } catch {
      toast.error("No se pudo guardar el esquema de pago")
    } finally {
      setSaving(false)
    }
  }

  const amountLabel =
    payType === "HOURLY" ? "Tarifa por hora ($)" :
    payType === "SALARY" ? "Sueldo por quincena ($)" :
    "Comisión sobre ventas (%)"

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Esquema de pago — {employee?.name}</DialogTitle>
          <DialogDescription>
            Define cómo se estima su sueldo en la nómina.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pay-type">Tipo de pago</Label>
            <Select value={payType} onValueChange={setPayType}>
              <SelectTrigger id="pay-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">Sin esquema</SelectItem>
                <SelectItem value="HOURLY">Por hora</SelectItem>
                <SelectItem value="SALARY">Quincenal</SelectItem>
                <SelectItem value="COMMISSION">Comisión</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {payType !== "NONE" && (
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">{amountLabel}</Label>
              <Input
                id="pay-amount"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder={payType === "COMMISSION" ? "5" : "0.00"}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const fmtHours = (min: number) => {
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h} h` : `${h} h ${m} m`
}

const detailOf = (e: NominaEmployee): string => {
  const { hourly, salary, commission } = e.breakdown
  if (hourly) return `${hourly.hours} h × ${formatPrice(hourly.rateCents / 100)}/h`
  if (salary) return `${formatPrice(salary.rateCents / 100)}/quincena × ${salary.daysInPeriod}/15 días`
  if (commission) return `${commission.pct}% de ${formatPrice(commission.baseCents / 100)}`
  return "—"
}

/**
 * Estimado de nómina (solo ADMIN): sueldo sugerido por empleado en el
 * periodo según su esquema de pago — por hora sobre tiempo activo, sueldo
 * quincenal prorrateado o comisión sobre ventas cobradas. Consume
 * GET /api/actividad/nomina.
 */
export function NominaPanel() {
  const [employees, setEmployees] = useState<NominaEmployee[]>([])
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null)
  const [preset, setPreset] = useState<Preset>("quincena")
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [configFor, setConfigFor] = useState<NominaEmployee | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    setForbidden(false)
    try {
      const { from, to } = rangeFor(preset)
      const res = await fetch(`/api/actividad/nomina?from=${from}&to=${to}`, { signal })
      if (signal?.aborted) return
      if (res.status === 401 || res.status === 403) {
        setForbidden(true)
        setEmployees([])
        return
      }
      if (!res.ok) throw new Error()
      const data = await res.json()
      if (signal?.aborted) return
      setEmployees(data.employees ?? [])
      setPeriod(data.period ?? null)
    } catch {
      if (!signal?.aborted) setError("No se pudo cargar el estimado de nómina")
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [preset])

  useEffect(() => {
    const controller = new AbortController()
    const t = setTimeout(() => { void load(controller.signal) }, 0)
    return () => {
      clearTimeout(t)
      controller.abort()
    }
  }, [load])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return employees
    return employees.filter(e =>
      e.name.toLowerCase().includes(q) || (e.jobTitle ?? "").toLowerCase().includes(q)
    )
  }, [employees, searchQuery])

  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, e) => ({
          estimatedCents: acc.estimatedCents + e.estimatedCents,
          salesTotalCents: acc.salesTotalCents + e.salesTotalCents,
          minutesActive: acc.minutesActive + e.minutesActive,
        }),
        { estimatedCents: 0, salesTotalCents: 0, minutesActive: 0 }
      ),
    [filtered]
  )

  const handleExportCsv = () => {
    if (filtered.length === 0) return
    const headers = [
      "Empleado",
      "Puesto",
      "Tipo de pago",
      "Días activo",
      "Horas activas",
      "Ventas (MXN)",
      "Núm. ventas",
      "Estimado (MXN)",
      "Detalle",
    ]
    const rows = filtered.map(e => [
      e.name,
      e.jobTitle?.trim() || "",
      PAY_TYPE_LABELS[e.payType] || e.payType,
      e.daysActive,
      (e.minutesActive / 60).toFixed(2),
      (e.salesTotalCents / 100).toFixed(2),
      e.salesCount,
      (e.estimatedCents / 100).toFixed(2),
      detailOf(e),
    ])
    const lines = [headers.map(csvCell).join(","), ...rows.map(r => r.map(csvCell).join(","))]
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `nomina-${period?.from ?? ""}_${period?.to ?? ""}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (forbidden) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <ShieldAlert className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground text-center">
          Solo administradores pueden ver el estimado de nómina
        </p>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Banknote className="h-5 w-5" />
            Estimado de nómina
          </CardTitle>
          <CardDescription>
            Sueldo sugerido por empleado según su esquema de pago y la actividad registrada
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-52">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filtrar por empleado..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              aria-label="Filtrar nómina por nombre o puesto"
              className="pl-8 h-9"
            />
          </div>
          <Select value={preset} onValueChange={v => setPreset(v as Preset)}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="14d">Últimos 14 días</SelectItem>
              <SelectItem value="30d">Últimos 30 días</SelectItem>
              <SelectItem value="mes">Mes actual</SelectItem>
              <SelectItem value="quincena">Quincena actual</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={loading || filtered.length === 0}
            aria-label="Exportar estimado de nómina a CSV"
          >
            <Download className="h-4 w-4 mr-1.5" />
            Exportar CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="flex items-center gap-3">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Reintentar
            </Button>
          </div>
        )}
        {loading && !error && (
          <div className="space-y-3" aria-label="Cargando estimado de nómina">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
            <Skeleton className="h-48 w-full" />
          </div>
        )}
        {!error && !loading && employees.length === 0 && (
          <p className="text-sm text-muted-foreground">Sin empleados registrados.</p>
        )}
        {!error && !loading && employees.length > 0 && filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Sin resultados para &ldquo;{searchQuery.trim()}&rdquo;.
          </p>
        )}
        {!error && !loading && filtered.length > 0 && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">Total estimado del periodo</div>
                <div className="text-lg font-semibold mt-0.5">{formatPrice(totals.estimatedCents / 100)}</div>
                <div className="text-xs text-muted-foreground">
                  {period ? `${period.from} → ${period.to}` : ""}
                </div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">Ventas del equipo</div>
                <div className="text-lg font-semibold mt-0.5">{formatPrice(totals.salesTotalCents / 100)}</div>
                <div className="text-xs text-muted-foreground">Base de comisiones</div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">Tiempo activo total</div>
                <div className="text-lg font-semibold mt-0.5">{fmtHours(totals.minutesActive)}</div>
                <div className="text-xs text-muted-foreground">Suma de jornadas reconstruidas</div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empleado</TableHead>
                    <TableHead>Tipo de pago</TableHead>
                    <TableHead className="text-right">Días activo</TableHead>
                    <TableHead className="text-right">Horas activas</TableHead>
                    <TableHead className="text-right">Ventas</TableHead>
                    <TableHead className="text-right">Estimado</TableHead>
                    <TableHead>Detalle</TableHead>
                    <TableHead className="text-right">Esquema</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(e => (
                    <TableRow key={e.userId}>
                      <TableCell>
                        <div className="font-medium">{e.name}</div>
                        {e.jobTitle && <div className="text-xs text-muted-foreground">{e.jobTitle}</div>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={e.payType === "NONE" ? "outline" : "secondary"}>
                          {PAY_TYPE_LABELS[e.payType] || e.payType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline">{e.daysActive}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtHours(e.minutesActive)}</TableCell>
                      <TableCell className="text-right">
                        <div className="tabular-nums">{formatPrice(e.salesTotalCents / 100)}</div>
                        <div className="text-xs text-muted-foreground">
                          {e.salesCount} {e.salesCount === 1 ? "venta" : "ventas"}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatPrice(e.estimatedCents / 100)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{detailOf(e)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfigFor(e)}
                          aria-label={`Configurar esquema de pago de ${e.name}`}
                        >
                          <Settings2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
        <p className="text-xs text-muted-foreground">
          Estimado basado en actividad registrada — no sustituye nómina fiscal.
        </p>
      </CardContent>
      <PayConfigDialog
        key={configFor?.userId ?? "closed"}
        employee={configFor}
        open={configFor !== null}
        onClose={() => setConfigFor(null)}
        onSaved={() => void load()}
      />
    </Card>
  )
}
