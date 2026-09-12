"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Wrench, Plus, ArrowLeft, MapPin, Search, ClipboardList, Clock3 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { repairFolio, repairLabels, repairNextStages, type RepairStage } from "@/lib/workshop-labels"
import { toast } from "sonner"

type Branch = { id: string; name: string }
type ActionDraft = { detail?: string; quote?: string; status?: string; branchId?: string; assignedToId?: string }
type Order = {
  id: string; number: number; version: number; status: RepairStage; customerName: string; customerPhone: string;
  equipmentType: string; brand: string | null; model: string | null; serialNumber: string | null; accessories: string | null;
  intakeCondition: string | null; reportedIssue: string; diagnosis: string | null; quoteCents: number | null;
  approvedQuoteCents: number | null; currentBranch: Branch; intakeBranch: Branch; assignedTo: Branch | null; createdAt: string;
  events?: { id: string; detail: string; createdAt: string; actor: { name: string } }[];
}
const inputClass = "w-full rounded-lg border bg-background px-3 py-2 text-sm"
const money = (value: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(value / 100)
const date = (value: string) => new Date(value).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })

export default function WorkshopPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [staff, setStaff] = useState<Branch[]>([])
  const [branch, setBranch] = useState("")
  const [stage, setStage] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<Order | null>(null)
  const [saving, setSaving] = useState(false)
  const [action, setAction] = useState("NOTE")
  const [drafts, setDrafts] = useState<Record<string, ActionDraft>>({})
  const [intakeDirty, setIntakeDirty] = useState(false)
  const [discardDialog, setDiscardDialog] = useState(false)
  const [opening, setOpening] = useState(false)
  const operationKey = useRef<ClientOperationKey | null>(null)
  const inFlight = useRef(false)
  const requestVersion = useRef(0)
  const detailVersion = useRef(0)
  const detailRequest = useRef<AbortController | null>(null)
  const draft = drafts[action] ?? {}
  const hasUnsavedChanges = intakeDirty || Object.values(drafts).some(value => Object.values(value).some(field => typeof field === "string" && field !== ""))
  const updateDraft = (changes: ActionDraft) => setDrafts(previous => ({ ...previous, [action]: { ...previous[action], ...changes } }))

  useEffect(() => () => {
    detailVersion.current += 1
    detailRequest.current?.abort()
  }, [])
  useEffect(() => {
    if (!hasUnsavedChanges) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    window.addEventListener("beforeunload", warnBeforeUnload)
    return () => window.removeEventListener("beforeunload", warnBeforeUnload)
  }, [hasUnsavedChanges])

  function backToOrders() {
    detailVersion.current += 1
    detailRequest.current?.abort()
    detailRequest.current = null
    setOpening(false); setCreating(false); setSelected(null); setAction("NOTE")
    setDrafts({}); setIntakeDirty(false); setDiscardDialog(false)
  }
  const load = useCallback(async () => {
    const version = ++requestVersion.current
    setLoading(true); setError("")
    try {
      const params = new URLSearchParams({ q: search, branchId: branch, status: stage, page: String(page) })
      const response = await fetch(`/api/workshop?${params}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "No se pudieron cargar las órdenes")
      if (version !== requestVersion.current) return
      setOrders(data.orders); setBranches(data.branches); setStaff(data.staff); setPages(data.totalPages); setTotal(data.total)
    } catch (cause) { if (version === requestVersion.current) setError(cause instanceof Error ? cause.message : "Error de conexión") }
    finally { if (version === requestVersion.current) setLoading(false) }
  }, [branch, page, search, stage])
  useEffect(() => { const timer = setTimeout(() => { void load() }, 200); return () => clearTimeout(timer) }, [load])

  async function openOrder(id: string, preserveDrafts = false) {
    const version = ++detailVersion.current
    detailRequest.current?.abort()
    const controller = new AbortController()
    detailRequest.current = controller
    setOpening(true)
    try {
      const response = await fetch(`/api/workshop/${id}`, { signal: controller.signal })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      if (controller.signal.aborted || version !== detailVersion.current) return
      const order: Order = data.order
      if (!preserveDrafts || selected?.id !== order.id || ["DELIVERED", "CANCELLED"].includes(order.status)) {
        setDrafts({}); setAction("NOTE")
      } else {
        // Authorization text belongs to the specific quote the operator reviewed.
        if (selected.quoteCents !== order.quoteCents || order.status !== "WAITING_APPROVAL") {
          setDrafts(previous => { const next = { ...previous }; delete next.APPROVE; return next })
        }
        const available = ["NOTE", "ASSIGN", "TRANSFER", ...(repairNextStages[order.status].length ? ["STATUS"] : []), ...(["DIAGNOSIS", "WAITING_APPROVAL"].includes(order.status) ? ["QUOTE"] : []), ...(order.status === "WAITING_APPROVAL" ? ["APPROVE"] : [])]
        if (!available.includes(action)) setAction("NOTE")
      }
      setSelected(order); setCreating(false); setIntakeDirty(false)
    } catch {
      if (!controller.signal.aborted && version === detailVersion.current) toast.error("No se pudo abrir la orden. Intenta de nuevo.")
    } finally {
      if (version === detailVersion.current) { setOpening(false); detailRequest.current = null }
    }
  }
  async function post(url: string, payload: Record<string, unknown>) {
    operationKey.current = getClientOperationKey(operationKey.current, { url, ...payload })
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, idempotencyKey: operationKey.current.key }) })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || "No se confirmó el cambio")
    operationKey.current = null
    return data
  }
  async function submit(event: React.FormEvent<HTMLFormElement>, kind: "order" | "branch" | "update") {
    event.preventDefault()
    if (inFlight.current || opening) return
    inFlight.current = true; setSaving(true)
    const form = event.currentTarget
    const fields = Object.fromEntries(new FormData(form).entries()) as Record<string, string>
    try {
      if (kind === "branch") {
        await post("/api/workshop", { action: "CREATE_BRANCH", name: fields.name }); form.reset(); await load()
      } else if (kind === "order") {
        const data = await post("/api/workshop", Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== "")))
        setIntakeDirty(false); setCreating(false); await load(); await openOrder(data.order.id)
      } else if (selected) {
        const quote = fields.quote === undefined ? undefined : Number(fields.quote)
        if (quote !== undefined && (!Number.isFinite(quote) || quote < 0 || Math.abs(quote * 100 - Math.round(quote * 100)) > 0.000001)) throw new Error("El presupuesto admite hasta dos decimales")
        await post(`/api/workshop/${selected.id}`, { action, expectedVersion: selected.version, detail: fields.detail, status: fields.status, branchId: fields.branchId, assignedToId: fields.assignedToId, quoteCents: quote === undefined ? undefined : Math.round(quote * 100) })
        setDrafts(previous => {
          const next = { ...previous }
          delete next[action]
          if (action === "QUOTE") delete next.APPROVE
          return next
        })
        form.reset(); await openOrder(selected.id, true); await load()
      }
      toast.success("Cambio guardado")
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "No se confirmó el cambio. Reintenta sin cambiar los datos.") }
    finally { inFlight.current = false; setSaving(false) }
  }

  return <div className="mx-auto max-w-6xl space-y-6 pb-20">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="text-sm font-medium text-primary">ProSolutions · Taller</p><h1 className="mt-1 text-3xl font-bold">{creating ? "Recibir equipo" : selected ? repairFolio(selected.number) : "Órdenes de servicio"}</h1><p className="mt-2 text-muted-foreground">{selected ? `${selected.customerName} · ${selected.equipmentType}` : "De la recepción a la entrega, con un historial por equipo."}</p></div>
      {creating || selected || opening ? <Button variant="outline" disabled={saving} onClick={() => { if (hasUnsavedChanges) setDiscardDialog(true); else backToOrders() }}><ArrowLeft className="mr-2 h-4 w-4" />Volver a órdenes</Button>
        : <Button disabled={!branches.length || loading} onClick={() => { setIntakeDirty(false); setCreating(true) }}><Plus className="mr-2 h-4 w-4" />Recibir equipo</Button>}
    </div>
    <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"><strong>Piloto para revisión del dueño.</strong> Prueba con equipos ficticios. Este módulo registra recepción y seguimiento; los presupuestos y las entregas aún no generan cobros ni movimientos de refacciones. Acceso inicial: administradores.</div>
    {opening && <p role="status" aria-live="polite" className="text-sm text-muted-foreground">Abriendo orden…</p>}
    {error && <div role="alert" className="rounded-lg border p-4 text-destructive">{error}<Button variant="outline" className="ml-3" onClick={() => void load()}>Reintentar</Button></div>}
    {!selected && !creating && <>
      <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-3">
        <label className="text-sm">Buscar folio, cliente, teléfono, modelo o serie<div className="relative mt-2"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input value={search} className="pl-9" placeholder="OT-000001, teléfono o modelo…" onChange={e => { setSearch(e.target.value); setPage(1) }} /></div></label>
        <label className="text-sm">Ubicación actual<select className={`${inputClass} mt-2`} value={branch} onChange={e => { setBranch(e.target.value); setPage(1) }}><option value="">Todas las sucursales</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label className="text-sm">Etapa<select className={`${inputClass} mt-2`} value={stage} onChange={e => { setStage(e.target.value); setPage(1) }}><option value="">Todas las etapas</option>{Object.entries(repairLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      {loading ? <p role="status">Cargando órdenes…</p> : orders.length === 0 ? <div className="rounded-xl border border-dashed p-12 text-center"><ClipboardList className="mx-auto mb-3 h-10 w-10 text-muted-foreground" /><h2 className="text-lg font-semibold">{total === 0 && !search && !stage && !branch ? "Todo listo para la primera recepción" : "No hay órdenes con estos filtros"}</h2><p className="mt-2 text-muted-foreground">{branches.length ? "Usa Recibir equipo para comenzar." : "Registra abajo las sucursales del taller."}</p></div> : <div className="grid gap-3 md:grid-cols-2">{orders.map(order => <button key={order.id} onClick={() => void openOrder(order.id)} className="space-y-3 rounded-xl border bg-card p-5 text-left transition hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"><div className="flex justify-between gap-3"><strong>{repairFolio(order.number)}</strong><span className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">{repairLabels[order.status]}</span></div><div><h2 className="font-semibold">{[order.equipmentType, order.brand, order.model].filter(Boolean).join(" · ")}</h2><p className="text-sm text-muted-foreground">{order.customerName}</p></div><p className="line-clamp-2 text-sm">{order.reportedIssue}</p><div className="flex flex-wrap gap-3 text-xs text-muted-foreground"><span className="flex items-center gap-1"><MapPin size={14} />{order.currentBranch.name}</span><span className="flex items-center gap-1"><Wrench size={14} />{order.assignedTo?.name ?? "Sin asignar"}</span><span className="flex items-center gap-1"><Clock3 size={14} />{date(order.createdAt)}</span></div></button>)}</div>}
      <div className="flex items-center justify-between text-sm"><span>{total} órdenes · Página {page} de {pages}</span><div className="flex gap-2"><Button variant="outline" disabled={page === 1 || loading} onClick={() => setPage(p => p - 1)}>Anterior</Button><Button variant="outline" disabled={page >= pages || loading} onClick={() => setPage(p => p + 1)}>Siguiente</Button></div></div>
      <details className="rounded-xl border bg-card p-4"><summary className="cursor-pointer font-medium">Sucursales del taller ({branches.length})</summary><p className="my-3 text-sm text-muted-foreground">{branches.map(b => b.name).join(" · ") || "Todavía no hay sucursales."} Las ubicaciones de equipos se administran aquí y en Sucursales; el inventario es independiente por sucursal.</p><form onSubmit={e => void submit(e, "branch")} className="flex max-w-md gap-2"><Input name="name" aria-label="Nombre de la sucursal" required minLength={2} maxLength={80} placeholder="Nombre de la sucursal" /><Button disabled={saving}>Agregar</Button></form></details>
    </>}
    {creating && <form onChange={() => setIntakeDirty(true)} onSubmit={e => void submit(e, "order")} className="space-y-6 rounded-xl border bg-card p-6"><fieldset disabled={saving} className="grid gap-5 sm:grid-cols-2">
      <label className="space-y-2 text-sm">Cliente *<Input name="customerName" required maxLength={100} autoComplete="name" /></label>
      <label className="space-y-2 text-sm">Teléfono de contacto *<Input name="customerPhone" required minLength={7} maxLength={30} type="tel" autoComplete="tel" /></label>
      <label className="space-y-2 text-sm">Sucursal de recepción *<select name="intakeBranchId" required className={inputClass} defaultValue={branch}><option value="" disabled>Selecciona la sucursal de recepción</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label className="space-y-2 text-sm">Responsable técnico<select name="assignedToId" className={inputClass}><option value="">Asignar después</option>{staff.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      <label className="space-y-2 text-sm">Tipo de equipo *<Input name="equipmentType" list="equipment-types" required maxLength={100} placeholder="Celular, consola, computadora…" /><datalist id="equipment-types">{["Celular", "Tablet", "Laptop", "Computadora", "Consola", "Televisión", "Audio", "Otro electrónico"].map(type => <option key={type} value={type} />)}</datalist></label>
      <label className="space-y-2 text-sm">Marca<Input name="brand" maxLength={100} /></label><label className="space-y-2 text-sm">Modelo<Input name="model" maxLength={100} /></label><label className="space-y-2 text-sm">Serie o IMEI<Input name="serialNumber" maxLength={100} /></label>
      <label className="space-y-2 text-sm sm:col-span-2">Falla que reporta el cliente *<textarea name="reportedIssue" required maxLength={500} rows={3} className={inputClass} placeholder="Describe lo que ocurre y desde cuándo." /></label>
      <label className="space-y-2 text-sm">Estado físico al recibir<textarea name="intakeCondition" maxLength={500} rows={3} className={inputClass} placeholder="Golpes, humedad, piezas faltantes…" /></label><label className="space-y-2 text-sm">Accesorios recibidos<textarea name="accessories" maxLength={500} rows={3} className={inputClass} placeholder="Cargador, funda, controles…" /></label>
    </fieldset><p className="text-sm text-muted-foreground">No registres contraseñas, PIN ni patrones de desbloqueo en estos campos.</p><Button disabled={saving}>{saving ? "Guardando…" : "Crear orden"}</Button></form>}
    {selected && <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]"><div className="space-y-5"><section className="space-y-4 rounded-xl border bg-card p-5"><div className="flex justify-between"><h2 className="font-semibold">Equipo y recepción</h2><span className="text-sm text-primary">{repairLabels[selected.status]}</span></div><p>{[selected.equipmentType, selected.brand, selected.model].filter(Boolean).join(" · ")}</p><dl className="grid gap-3 text-sm"><div><dt className="text-muted-foreground">Falla reportada</dt><dd>{selected.reportedIssue}</dd></div>{[["Serie / IMEI", selected.serialNumber], ["Estado físico", selected.intakeCondition], ["Accesorios", selected.accessories], ["Contacto", `${selected.customerName} · ${selected.customerPhone}`], ["Recibido en", selected.intakeBranch.name], ["Ubicación actual", selected.currentBranch.name], ["Responsable", selected.assignedTo?.name ?? "Sin asignar"]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd>{value || "Sin registrar"}</dd></div>)}</dl></section>
      <section className="space-y-3 rounded-xl border bg-card p-5"><h2 className="font-semibold">Diagnóstico y presupuesto</h2><p className="whitespace-pre-wrap text-sm">{selected.diagnosis || "Pendiente de diagnóstico"}</p><p className="text-2xl font-semibold">{selected.quoteCents === null ? "Sin cotizar" : money(selected.quoteCents)}</p><p className="text-sm text-muted-foreground">{selected.approvedQuoteCents === null ? "Sin autorización registrada" : `Autorizado: ${money(selected.approvedQuoteCents)}`}</p><p className="text-xs text-muted-foreground">El presupuesto no confirma un pago. Anticipos y saldos se integrarán en la siguiente etapa.</p></section>
      {!['DELIVERED', 'CANCELLED'].includes(selected.status) && <form onSubmit={e => void submit(e, "update")} className="space-y-4 rounded-xl border bg-card p-5"><h2 className="font-semibold">Siguiente acción</h2><fieldset disabled={saving || opening} className="space-y-4"><label className="block text-sm">Acción<select value={action} onChange={e => setAction(e.target.value)} className={`${inputClass} mt-2`}><option value="NOTE">Agregar nota interna</option>{repairNextStages[selected.status].length > 0 && <option value="STATUS">Cambiar etapa</option>}{['DIAGNOSIS', 'WAITING_APPROVAL'].includes(selected.status) && <option value="QUOTE">Registrar diagnóstico y presupuesto</option>}{selected.status === 'WAITING_APPROVAL' && <option value="APPROVE">Registrar autorización del cliente</option>}<option value="ASSIGN">Asignar responsable</option><option value="TRANSFER">Registrar llegada a otra sucursal</option></select></label>
      {action === "STATUS" && <label className="block text-sm">Nueva etapa<select name="status" value={draft.status ?? repairNextStages[selected.status][0] ?? ""} onChange={e => updateDraft({ status: e.target.value })} className={`${inputClass} mt-2`}>{repairNextStages[selected.status].map(value => <option key={value} value={value}>{repairLabels[value]}</option>)}</select></label>}
      {action === "QUOTE" && <label className="block text-sm">Importe total en MXN<Input name="quote" type="number" min={0} max={1000000} step="0.01" required value={draft.quote ?? (selected.quoteCents === null ? "" : String(selected.quoteCents / 100))} onChange={e => updateDraft({ quote: e.target.value })} /></label>}
      {action === "ASSIGN" && <label className="block text-sm">Responsable técnico<select name="assignedToId" required value={draft.assignedToId ?? ""} onChange={e => updateDraft({ assignedToId: e.target.value })} className={`${inputClass} mt-2`}><option value="">Selecciona una persona</option>{staff.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}
      {action === "TRANSFER" && <label className="block text-sm">Sucursal donde se recibió el equipo<select name="branchId" required value={draft.branchId ?? ""} onChange={e => updateDraft({ branchId: e.target.value })} className={`${inputClass} mt-2`}><option value="">Selecciona la sucursal destino</option>{branches.filter(b => b.id !== selected.currentBranch.id).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
      <label className="block text-sm">{action === "APPROVE" ? "Quién autorizó y por qué medio" : action === "QUOTE" ? "Diagnóstico y alcance del trabajo" : "Detalle de la acción"}<textarea name="detail" value={draft.detail ?? ""} onChange={e => updateDraft({ detail: e.target.value })} required maxLength={2000} rows={3} className={`${inputClass} mt-2`} placeholder={action === "STATUS" ? "Para entregar: quién recibe. Para listo: resultado de la revisión final." : "Deja contexto para la siguiente persona que atienda la orden."} /></label><p className="text-xs text-muted-foreground">Cada acción conserva su propio borrador hasta guardarlo o salir de la orden.</p><Button disabled={saving || opening}>{saving ? "Guardando…" : "Guardar cambio"}</Button><Button variant="outline" type="button" disabled={saving || opening} onClick={() => void openOrder(selected.id, true)}>Actualizar orden</Button></fieldset></form>}
      </div><section className="h-fit rounded-xl border bg-card p-5"><h2 className="mb-5 font-semibold">Historial de la orden</h2><ol className="space-y-5">{selected.events?.map(event => <li key={event.id} className="border-l-2 border-primary/30 pl-4"><p className="whitespace-pre-wrap text-sm">{event.detail}</p><p className="mt-2 text-xs text-muted-foreground">{event.actor.name} · {date(event.createdAt)}</p></li>)}</ol></section></div>}
    <AlertDialog open={discardDialog} onOpenChange={setDiscardDialog}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>¿Descartar los cambios sin guardar?</AlertDialogTitle><AlertDialogDescription>Los datos de recepción y los borradores de acciones que no guardaste se perderán al volver a la lista.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Seguir editando</AlertDialogCancel><AlertDialogAction onClick={backToOrders}>Descartar y volver</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
}
