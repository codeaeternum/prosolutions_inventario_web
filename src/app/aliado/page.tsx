"use client"

// Portal del negocio aliado ("Telcel trae → el taller repara"): el usuario del
// negocio captador registra equipos desde mostrador y la orden nace en el
// tenant del taller reparador configurado por su admin. Esta página solo
// consume /api/workshop/partner — el vínculo, la sucursal y el actor los
// resuelve el servidor.
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  CalendarClock, Check, CheckCircle2, ClipboardList, Copy,
  ExternalLink, Link2Off, MessageCircle, PackagePlus, RefreshCw, Search, X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CollapsibleSection } from "@/components/admin/taller/collapsible-section"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { formatDate, formatDay, titleCaseName } from "@/lib/utils"
import { hasWhatsAppPhone, waLink } from "@/lib/whatsapp"

type PartnerOrder = {
  id: string
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
  // Credencial UUID del rastreo público (la comparte el aliado con su cliente).
  trackingToken?: string | null
}

type LastCapturedOrder = {
  folio: string
  customerName: string
  customerPhone: string
  equipment: string
  reportedIssue: string
  trackingToken?: string | null
}

type StatusFilter = "all" | "active" | "attention" | "closed"

const ATTENTION_STATUSES = new Set(["WAITING_APPROVAL", "READY"])
const CLOSED_STATUSES = new Set(["DELIVERED", "CANCELLED", "NOT_REPAIRED", "NOT_AUTHORIZED"])

function getOrderStatusGroup(status: string): Exclude<StatusFilter, "all"> {
  if (ATTENTION_STATUSES.has(status)) return "attention"
  if (CLOSED_STATUSES.has(status)) return "closed"
  return "active"
}

const STATUS_FILTER_OPTIONS: ReadonlyArray<{ id: StatusFilter; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "active", label: "En proceso" },
  // Etiquetas cortas: en teléfono (donde el portal se abre desde WhatsApp)
  // los chips no deben ocupar dos líneas.
  { id: "attention", label: "Por autorizar / Listos" },
  { id: "closed", label: "Cerrados" },
]

function phoneLast4(phone: string): string {
  return phone.replace(/\D/g, "").slice(-4)
}

// Promesa vencida se marca en ámbar ("· Atrasada"), mismo tratamiento que
// PromisedAt del tablero /admin/taller: una orden cerrada ya no compite
// contra su fecha prometida.
function isPromiseOverdue(order: PartnerOrder): boolean {
  return order.promisedAt !== null && !CLOSED_STATUSES.has(order.status) && new Date(order.promisedAt).getTime() < Date.now()
}

// Respaldo para contextos sin Clipboard API (HTTP por LAN/Tailscale no es
// "secure context", mismo caso que documenta lib/client-operation-key):
// textarea temporal + execCommand — antes se anunciaba "¡Copiado!" sin
// copiar nada.
function copyTextFallback(text: string) {
  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.opacity = "0"
  document.body.appendChild(area)
  area.select()
  const copied = document.execCommand("copy")
  document.body.removeChild(area)
  if (!copied) throw new Error("execCommand copy failed")
}

// El link nuevo lleva el trackingToken (?t=<uuid>) y ya no expone el
// teléfono del cliente en la URL; el formato folio + últimos 4 dígitos queda
// como respaldo para órdenes sin token.
function buildTrackingPath(folio: string, customerPhone: string, trackingToken?: string | null): string {
  if (trackingToken) return `/seguimiento?t=${encodeURIComponent(trackingToken)}`
  const phone4 = phoneLast4(customerPhone)
  return `/seguimiento?folio=${encodeURIComponent(folio)}&t=${phone4}`
}

function buildTrackingUrl(folio: string, customerPhone: string, trackingToken?: string | null): string {
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  return `${origin}${buildTrackingPath(folio, customerPhone, trackingToken)}`
}

function buildCapturedWhatsAppHref(captured: LastCapturedOrder): string {
  const trackingUrl = buildTrackingUrl(captured.folio, captured.customerPhone, captured.trackingToken)
  const message = [
    `Hola ${captured.customerName}, recibimos tu equipo (${captured.equipment}) para revisión y reparación.`,
    `Folio: ${captured.folio}`,
    `Falla reportada: ${captured.reportedIssue}`,
    `Consulta el seguimiento en vivo en 1 toque: ${trackingUrl}`,
  ].join("\n")
  return waLink(captured.customerPhone, message)
}

function buildOrderWhatsAppHref(order: PartnerOrder): string {
  const equipment = [order.equipmentType, order.brand, order.model].filter(Boolean).join(" · ")
  const trackingUrl = buildTrackingUrl(order.folio, order.customerPhone, order.trackingToken)
  const message = `Hola ${order.customerName}, te compartimos el seguimiento de tu equipo ${equipment} (folio ${order.folio} · ${order.statusLabel}). Consulta el avance en 1 toque: ${trackingUrl}`
  return waLink(order.customerPhone, message)
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
  const [lastCaptured, setLastCaptured] = useState<LastCapturedOrder | null>(null)
  const [copiedLink, setCopiedLink] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  const update = (changes: Partial<typeof emptyForm>) => setForm(previous => ({ ...previous, ...changes }))

  async function copyTrackingUrl(folio: string, customerPhone: string, trackingToken?: string | null) {
    const url = buildTrackingUrl(folio, customerPhone, trackingToken)
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
      } else {
        copyTextFallback(url)
      }
      setCopiedLink(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopiedLink(false), 2500)
      toast.success("Link de seguimiento copiado")
    } catch {
      toast.error("No se pudo copiar el enlace")
    }
  }

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
      const capturedFolio = data?.order?.folio ?? String(data?.order?.number ?? "")
      toast.success(`Equipo capturado · folio ${data?.order?.number ?? ""}`)
      setLastCaptured({
        folio: capturedFolio,
        customerName,
        customerPhone,
        equipment: [form.equipmentType, brand, model].filter(Boolean).join(" · "),
        reportedIssue,
        trackingToken: data?.order?.trackingToken ?? null,
      })
      setCopiedLink(false)
      setForm(emptyForm)
      operationKey.current = null
      void load()
    } catch {
      toast.error("Sin conexión. Reintenta el envío.")
    } finally {
      setSaving(false)
    }
  }

  const statusCounts: Record<StatusFilter, number> = {
    all: orders.length,
    active: orders.filter(order => getOrderStatusGroup(order.status) === "active").length,
    attention: orders.filter(order => getOrderStatusGroup(order.status) === "attention").length,
    closed: orders.filter(order => getOrderStatusGroup(order.status) === "closed").length,
  }

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const queryDigits = normalizedQuery.replace(/\D/g, "")
  const filteredOrders = orders.filter(order => {
    if (statusFilter !== "all" && getOrderStatusGroup(order.status) !== statusFilter) {
      return false
    }
    if (!normalizedQuery) return true
    const haystack = [
      order.folio,
      String(order.number),
      order.customerName,
      order.customerPhone,
      order.equipmentType,
      order.brand ?? "",
      order.model ?? "",
      order.reportedIssue,
      order.statusLabel,
    ].join(" ").toLowerCase()
    if (haystack.includes(normalizedQuery)) return true
    if (queryDigits.length >= 3 && order.customerPhone.replace(/\D/g, "").includes(queryDigits)) return true
    return false
  })

  // CTA del estado vacío: lleva al formulario de captura. Si el usuario lo
  // había plegado, se abre con un clic real sobre el <summary> — así pasa por
  // el onToggle de CollapsibleSection y su estado interno queda sincronizado.
  function goToCapture() {
    const section = document.getElementById("captar-equipo")
    const details = section?.querySelector<HTMLDetailsElement>("details")
    if (details && !details.open) details.querySelector("summary")?.click()
    section?.scrollIntoView({ behavior: "smooth", block: "start" })
    // preventScroll: el scrollIntoView de la sección ya la posiciona.
    document.getElementById("customerName")?.focus({ preventScroll: true })
  }

  function clearFilters() {
    setSearchQuery("")
    setStatusFilter("all")
  }

  const lastCapturedPath = lastCaptured
    ? buildTrackingPath(lastCaptured.folio, lastCaptured.customerPhone, lastCaptured.trackingToken)
    : ""
  const lastCapturedUrl = lastCaptured
    ? buildTrackingUrl(lastCaptured.folio, lastCaptured.customerPhone, lastCaptured.trackingToken)
    : ""

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
        <CardContent className="space-y-4 text-center text-sm text-muted-foreground">
          <p>
            Para empezar, un administrador de tu negocio debe elegir el taller
            asociado en la configuración del negocio. En cuanto quede listo,
            aquí podrás capturar equipos y darles seguimiento.
          </p>
          {loadError && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
              {loadError}
            </p>
          )}
          {/* Tras configurar el vínculo no hace falta recargar la página. */}
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Ya quedó configurado — verificar de nuevo
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {lastCaptured && (
        // aria-live: la tarjeta aparece tras el envío y el lector de pantalla
        // la anuncia como confirmación persistente (el toast desaparece).
        <Card className="border-primary/30 bg-primary/5" aria-live="polite">
          <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-primary">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <span className="text-xs font-semibold uppercase tracking-wide">Equipo registrado con éxito</span>
              </div>
              <CardTitle className="text-2xl font-bold">
                Folio: {lastCaptured.folio}
              </CardTitle>
              <CardDescription className="text-foreground/80">
                {lastCaptured.customerName} ({lastCaptured.customerPhone}) · {lastCaptured.equipment}
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Cerrar confirmación"
              onClick={() => setLastCaptured(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Falla reportada:</span> {lastCaptured.reportedIssue}
            </p>
            <div className="rounded-md border border-primary/20 bg-background/80 px-3 py-2 text-xs">
              <span className="font-medium text-muted-foreground">Seguimiento público: </span>
              <a
                href={lastCapturedPath}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all font-mono text-primary underline-offset-4 hover:underline"
              >
                {lastCapturedUrl}
              </a>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button asChild size="sm">
                <a
                  href={buildCapturedWhatsAppHref(lastCaptured)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle className="mr-1.5 h-4 w-4" />
                  Enviar comprobante al cliente por WhatsApp
                </a>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void copyTrackingUrl(lastCaptured.folio, lastCaptured.customerPhone, lastCaptured.trackingToken)}
              >
                {copiedLink ? (
                  <>
                    <Check className="mr-1.5 h-4 w-4 text-emerald-600" />
                    ¡Copiado!
                  </>
                ) : (
                  <>
                    <Copy className="mr-1.5 h-4 w-4" />
                    Copiar link de seguimiento
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setLastCaptured(null)}
              >
                Cerrar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Captura plegable (mismo <details>/<summary> que la ficha del
          taller): quien solo viene a consultar envíos puede plegar el form
          y deja de hacer scroll por ~600px de campos en el teléfono. */}
      <div id="captar-equipo" className="scroll-mt-20">
        <CollapsibleSection
          title={
            <span className="flex items-center gap-2">
              <PackagePlus className="h-4 w-4" />
              Captar equipo
            </span>
          }
        >
          <p className="text-sm text-muted-foreground">
            Registra el equipo que el cliente deja en tu mostrador. El taller asociado lo recibe, lo repara y te avisa el avance.
          </p>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="customerName">Nombre del cliente *</Label>
                <Input
                  id="customerName" name="customerName" required
                  value={form.customerName}
                  onChange={e => update({ customerName: e.target.value })}
                  // Misma normalización que /admin/taller/recibir: "MARIA
                  // MARTINBEZ" queda "Maria Martinbez" al salir del campo.
                  onBlur={e => { const titled = titleCaseName(e.target.value); if (titled !== e.target.value) update({ customerName: titled }) }}
                  maxLength={500} autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="customerPhone">Teléfono *</Label>
                <Input id="customerPhone" name="customerPhone" required value={form.customerPhone} onChange={e => update({ customerPhone: e.target.value })} maxLength={30} inputMode="tel" autoComplete="off" placeholder="81 2345 6789" />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                {/* El trigger es un <button> (elemento etiquetable): htmlFor lo asocia igual que a un input. */}
                <Label htmlFor="equipmentType">Tipo de equipo *</Label>
                <Select value={form.equipmentType} onValueChange={value => update({ equipmentType: value })}>
                  <SelectTrigger id="equipmentType" name="equipmentType"><SelectValue placeholder="Selecciona" /></SelectTrigger>
                  <SelectContent>
                    {EQUIPMENT_TYPES.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="brand">Marca</Label>
                <Input id="brand" name="brand" value={form.brand} onChange={e => update({ brand: e.target.value })} maxLength={500} autoComplete="off" placeholder="Apple, Samsung…" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="model">Modelo</Label>
                <Input id="model" name="model" value={form.model} onChange={e => update({ model: e.target.value })} maxLength={500} autoComplete="off" placeholder="iPhone 13, A54…" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reportedIssue">Falla reportada *</Label>
              <Textarea id="reportedIssue" name="reportedIssue" required value={form.reportedIssue} onChange={e => update({ reportedIssue: e.target.value })} maxLength={500} placeholder="Lo que el cliente describe: no enciende, pantalla rota…" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="partnerPrice">Precio convenio (MXN, opcional)</Label>
                <Input id="partnerPrice" name="partnerPrice" value={form.partnerPrice} onChange={e => update({ partnerPrice: e.target.value })} inputMode="decimal" autoComplete="off" placeholder="0.00" />
                <p className="text-xs text-muted-foreground">Lo que el taller te cobra a ti por la reparación, según convenio.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="originContact">Contacto u origen (opcional)</Label>
                <Input id="originContact" name="originContact" value={form.originContact} onChange={e => update({ originContact: e.target.value })} maxLength={120} autoComplete="off" placeholder="Sucursal, mostrador, referencia…" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notas internas (opcional)</Label>
              <Textarea id="notes" name="notes" value={form.notes} onChange={e => update({ notes: e.target.value })} maxLength={500} placeholder="Solo las ven tu negocio y el taller; el cliente nunca las ve." />
            </div>

            <Button type="submit" disabled={saving} className="w-full sm:w-auto">
              {saving ? "Registrando…" : "Registrar equipo"}
            </Button>
          </form>
        </CollapsibleSection>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              Mis envíos
            </CardTitle>
            <CardDescription>Equipos que tu negocio ha enviado al taller.</CardDescription>
          </div>
          {/* En teléfono el botón queda solo-icono: el aria-label lo nombra. */}
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} aria-label="Actualizar envíos">
            <RefreshCw className={`h-4 w-4 sm:mr-2 ${loading ? "animate-spin" : ""}`} aria-hidden />
            <span className="hidden sm:inline">Actualizar</span>
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                id="aliado-search" name="search"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Buscar por folio, cliente, teléfono, marca/modelo o falla…"
                aria-label="Buscar envíos"
                autoComplete="off"
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar envíos por estado">
              {STATUS_FILTER_OPTIONS.map(option => {
                const active = statusFilter === option.id
                const count = statusCounts[option.id]
                return (
                  <button
                    key={option.id}
                    type="button"
                    data-filter={option.id}
                    aria-pressed={active}
                    onClick={() => setStatusFilter(option.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <span>{option.label}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] leading-none ${
                        active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-background text-foreground"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {loadError && (
            // Mismo patrón de error con reintento que /admin/taller.
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {loadError}
              <Button type="button" variant="outline" size="sm" className="ml-3" onClick={() => void load()} disabled={loading}>
                Reintentar
              </Button>
            </div>
          )}
          {!loadError && loading && orders.length === 0 && (
            // Carga inicial: antes quedaba un hueco en blanco bajo los filtros.
            <div role="status" aria-label="Cargando envíos" className="space-y-1.5">
              <span className="sr-only">Cargando envíos…</span>
              {[0, 1, 2].map(i => (
                <div key={i} className="space-y-1.5 rounded-lg border bg-card p-3" aria-hidden>
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          )}
          {!loadError && !loading && orders.length === 0 && (
            <div className="rounded-lg border border-dashed px-3 py-8 text-center">
              <ClipboardList className="mx-auto mb-2 h-8 w-8 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">Aún no has capturado equipos</p>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={goToCapture}>
                <PackagePlus className="mr-1.5 h-4 w-4" />
                Registrar el primer equipo
              </Button>
            </div>
          )}
          {!loadError && !loading && orders.length > 0 && filteredOrders.length === 0 && (
            <div className="rounded-lg border border-dashed px-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">No se encontraron envíos con los filtros actuales</p>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={clearFilters}>
                Limpiar filtros
              </Button>
            </div>
          )}
          {/* Fila compacta (estándar del tablero del taller): folio+etapa,
              equipo, cliente y falla en 4 líneas cortas; fechas y acciones
              en el pie. */}
          {filteredOrders.map(order => (
            <article key={order.id} className="space-y-1 rounded-lg border bg-card p-3 text-sm">
              <p className="flex items-center justify-between gap-2">
                <strong className="text-xs font-medium text-muted-foreground">{order.folio}</strong>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass[order.status] ?? fallbackBadgeClass}`}>
                  {order.statusLabel}
                </span>
              </p>
              <p className="truncate font-medium leading-snug">
                {[order.equipmentType, order.brand, order.model].filter(Boolean).join(" · ")}
              </p>
              <p className="truncate text-xs text-muted-foreground">{order.customerName} · {order.customerPhone}</p>
              <p className="line-clamp-2 text-xs text-muted-foreground">{order.reportedIssue}</p>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 pt-1">
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span>Capturado {formatDate(order.createdAt)}</span>
                  {order.promisedAt && (
                    <span className={`flex items-center gap-1 ${isPromiseOverdue(order) ? "font-medium text-amber-600 dark:text-amber-400" : ""}`}>
                      <CalendarClock size={12} aria-hidden />
                      Promesa {formatDay(order.promisedAt)}
                      {isPromiseOverdue(order) && " · Atrasada"}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {hasWhatsAppPhone(order.customerPhone) && (
                    <Button asChild variant="outline" size="sm" className="h-7 px-2.5 text-xs">
                      <a
                        href={buildOrderWhatsAppHref(order)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Compartir rastreo de ${order.folio} por WhatsApp`}
                      >
                        <MessageCircle className="mr-1 h-3.5 w-3.5" aria-hidden />
                        WhatsApp
                      </a>
                    </Button>
                  )}
                  <Button asChild variant="ghost" size="sm" className="h-7 px-2.5 text-xs">
                    <a
                      href={buildTrackingPath(order.folio, order.customerPhone, order.trackingToken)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Abrir rastreo público de ${order.folio}`}
                    >
                      <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden />
                      Ver rastreo
                    </a>
                  </Button>
                </div>
              </div>
            </article>
          ))}
          {/* El API devuelve máximo 100; el aviso evita que la lista parezca
              completa cuando hay historial más viejo. */}
          {!loadError && !loading && orders.length >= 100 && (
            <p className="text-xs text-muted-foreground">Mostrando los 100 envíos más recientes.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
