"use client"

// Portal del negocio aliado ("Telcel trae → el taller repara"): el usuario del
// negocio captador registra equipos desde mostrador y la orden nace en el
// tenant del taller reparador configurado por su admin. Esta página solo
// consume /api/workshop/partner — el vínculo, la sucursal y el actor los
// resuelve el servidor.
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { CalendarClock, ClipboardList, Link2Off, PackagePlus, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { formatDate, formatDay } from "@/lib/utils"

type PartnerOrder = {
  number: number
  folio: string
  status: string
  statusLabel: string
  customerName: string
  customerPhone: string
  equipmentType: string
  brand: string | null
  model: string | null
  reportedIssue: string
  createdAt: string
  promisedAt: string | null
}

const EQUIPMENT_TYPES = ["Celular", "Tablet", "Computadora", "Consola", "TV", "Otro"]
const emptyForm = {
  customerName: "", customerPhone: "", equipmentType: "Celular",
  brand: "", model: "", reportedIssue: "", partnerPrice: "",
  originContact: "", notes: "",
}
const UNLINKED_MESSAGE = "no tiene taller asociado"
// Misma paleta de etapas que /admin/taller (status llega del servidor; el
// fallback cubre valores históricos o futuros).
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

export default function AliadoPage() {
  const [orders, setOrders] = useState<PartnerOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  // Sin vínculo aliado→reparador el API responde 400 con mensaje fijo: la UI
  // cambia a una tarjeta amable en vez de un error de formulario.
  const [unlinked, setUnlinked] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const operationKey = useRef<ClientOperationKey | null>(null)
  const requestVersion = useRef(0)

  const load = useCallback(async () => {
    const version = ++requestVersion.current
    setLoading(true)
    setLoadError("")
    try {
      const response = await fetch("/api/workshop/partner")
      const data = await response.json().catch(() => ({}))
      if (version !== requestVersion.current) return
      if (!response.ok) {
        if (typeof data.error === "string" && data.error.includes(UNLINKED_MESSAGE)) {
          setUnlinked(true)
          setOrders([])
        } else {
          setLoadError(data.error || "No se pudieron cargar tus envíos")
        }
        return
      }
      setUnlinked(false)
      setOrders(Array.isArray(data.orders) ? data.orders : [])
    } catch {
      if (version !== requestVersion.current) return
      setLoadError("No se pudieron cargar tus envíos")
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [])

  // Carga inicial diferida un tick (mismo patrón que /admin/taller): evita
  // setState sincrónico dentro del efecto y permite cancelar al desmontar.
  useEffect(() => {
    const timer = setTimeout(() => { void load() }, 0)
    return () => clearTimeout(timer)
  }, [load])

  const update = (changes: Partial<typeof emptyForm>) => setForm(previous => ({ ...previous, ...changes }))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return

    const customerName = form.customerName.trim()
    const customerPhone = form.customerPhone.trim()
    const reportedIssue = form.reportedIssue.trim()
    const brand = form.brand.trim()
    const model = form.model.trim()
    const originContact = form.originContact.trim()
    const notes = form.notes.trim()

    if (!customerName) { toast.error("Escribe el nombre del cliente."); return }
    if (!/^[+\d\s()-]+$/.test(customerPhone) || customerPhone.replace(/\D/g, "").length < 7) {
      toast.error("Escribe un teléfono válido (mínimo 7 dígitos).")
      return
    }
    if (!reportedIssue) { toast.error("Describe la falla que reporta el cliente."); return }

    let partnerPriceCents: number | undefined
    if (form.partnerPrice.trim() !== "") {
      const price = Number(form.partnerPrice)
      if (!Number.isFinite(price) || price < 0) {
        toast.error("El precio de convenio debe ser un importe válido.")
        return
      }
      partnerPriceCents = Math.round(price * 100)
    }

    const payload = {
      customerName, customerPhone, equipmentType: form.equipmentType,
      brand: brand || undefined, model: model || undefined, reportedIssue,
      partnerPriceCents, originContact: originContact || undefined, notes: notes || undefined,
    }
    // La clave se conserva si se reintenta el MISMO envío tras un corte de red
    // (evita duplicados) y se renueva sola al capturar un equipo distinto.
    operationKey.current = getClientOperationKey(operationKey.current, payload)
    setSaving(true)
    try {
      const response = await fetch("/api/workshop/partner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, idempotencyKey: operationKey.current.key }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (typeof data.error === "string" && data.error.includes(UNLINKED_MESSAGE)) setUnlinked(true)
        toast.error(data.error || "No se pudo registrar el equipo.")
        return
      }
      toast.success(`Equipo capturado · folio ${data?.order?.number ?? ""}`)
      setForm(emptyForm)
      operationKey.current = null
      load()
    } catch {
      toast.error("Sin conexión. Reintenta el envío.")
    } finally {
      setSaving(false)
    }
  }

  if (unlinked) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
            <Link2Off className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          </div>
          <CardTitle>Falta vincular tu taller reparador</CardTitle>
          <CardDescription>
            Este portal envía los equipos que capturas al taller que repara por ti.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center text-sm text-muted-foreground">
          <p>
            Para empezar, un administrador de tu negocio debe elegir el taller
            asociado en la configuración del negocio. En cuanto quede listo,
            aquí podrás capturar equipos y darles seguimiento.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackagePlus className="h-5 w-5" />
            Captar equipo
          </CardTitle>
          <CardDescription>
            Registra el equipo que el cliente deja en tu mostrador. El taller asociado lo recibe, lo repara y te avisa el avance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="customerName">Nombre del cliente *</Label>
                <Input id="customerName" value={form.customerName} onChange={e => update({ customerName: e.target.value })} maxLength={500} autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="customerPhone">Teléfono *</Label>
                <Input id="customerPhone" value={form.customerPhone} onChange={e => update({ customerPhone: e.target.value })} maxLength={30} inputMode="tel" autoComplete="off" placeholder="81 2345 6789" />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Tipo de equipo *</Label>
                <Select value={form.equipmentType} onValueChange={value => update({ equipmentType: value })}>
                  <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
                  <SelectContent>
                    {EQUIPMENT_TYPES.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="brand">Marca</Label>
                <Input id="brand" value={form.brand} onChange={e => update({ brand: e.target.value })} maxLength={500} autoComplete="off" placeholder="Apple, Samsung…" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="model">Modelo</Label>
                <Input id="model" value={form.model} onChange={e => update({ model: e.target.value })} maxLength={500} autoComplete="off" placeholder="iPhone 13, A54…" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reportedIssue">Falla reportada *</Label>
              <Textarea id="reportedIssue" value={form.reportedIssue} onChange={e => update({ reportedIssue: e.target.value })} maxLength={500} placeholder="Lo que el cliente describe: no enciende, pantalla rota…" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="partnerPrice">Precio convenio (MXN, opcional)</Label>
                <Input id="partnerPrice" value={form.partnerPrice} onChange={e => update({ partnerPrice: e.target.value })} inputMode="decimal" autoComplete="off" placeholder="0.00" />
                <p className="text-xs text-muted-foreground">Lo que el taller te cobra a ti por la reparación, según convenio.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="originContact">Contacto u origen (opcional)</Label>
                <Input id="originContact" value={form.originContact} onChange={e => update({ originContact: e.target.value })} maxLength={120} autoComplete="off" placeholder="Sucursal, mostrador, referencia…" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notas internas (opcional)</Label>
              <Textarea id="notes" value={form.notes} onChange={e => update({ notes: e.target.value })} maxLength={500} placeholder="Solo las ven tu negocio y el taller; el cliente nunca las ve." />
            </div>

            <Button type="submit" disabled={saving} className="w-full sm:w-auto">
              {saving ? "Registrando…" : "Registrar equipo"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              Mis envíos
            </CardTitle>
            <CardDescription>Equipos que tu negocio ha enviado al taller.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 sm:mr-2 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Actualizar</span>
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadError && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {loadError}
            </p>
          )}
          {!loadError && !loading && orders.length === 0 && (
            <p className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
              Aún no has capturado equipos
            </p>
          )}
          {orders.map(order => (
            <article key={order.folio} className="space-y-1.5 rounded-lg border bg-card p-4 text-sm">
              <p className="flex items-center justify-between gap-2">
                <strong className="text-xs text-muted-foreground">{order.folio}</strong>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass[order.status] ?? fallbackBadgeClass}`}>
                  {order.statusLabel}
                </span>
              </p>
              <p className="font-medium leading-snug">
                {[order.equipmentType, order.brand, order.model].filter(Boolean).join(" · ")}
              </p>
              <p className="text-xs text-muted-foreground">{order.customerName} · {order.customerPhone}</p>
              <p className="line-clamp-2 text-muted-foreground">{order.reportedIssue}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
                <span>Capturado {formatDate(order.createdAt)}</span>
                {order.promisedAt && (
                  <span className="flex items-center gap-1">
                    <CalendarClock size={12} />
                    Promesa {formatDay(order.promisedAt)}
                  </span>
                )}
              </div>
            </article>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
