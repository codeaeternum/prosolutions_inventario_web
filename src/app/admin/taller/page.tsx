"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Wrench, Plus, ArrowLeft, MapPin, Search, ClipboardList, Clock3, CalendarClock, Printer, Eye, EyeOff, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { useSession } from "next-auth/react"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { repairDeliverableStages, repairFolio, repairLabels, repairNextStages, type RepairStage } from "@/lib/workshop-labels"
import { BusinessName } from "@/components/admin/business-name"
import { ShareRepairOrder } from "@/components/admin/taller/share-order"
import { OrderHistory, type WorkshopEvent } from "@/components/admin/taller/order-history"
import { PaymentsPanel, emptyPaymentForm, emptyRefundForm, emptySettleForm, orderBalanceCents, type PaymentForm, type RefundForm, type SettleForm, type WorkshopPayment } from "@/components/admin/taller/payments-panel"
import { WorkPlan, toLocalInput, type PlanForm } from "@/components/admin/taller/work-plan"
import { PartsSection, type PartActionPayload } from "@/components/admin/taller/parts-section"
import { ExportButton } from "@/components/admin/export-button"
import { EvidenceSection } from "@/components/admin/taller/evidence-section"
import { toast } from "sonner"

type Branch = { id: string; name: string }
type ActionDraft = { detail?: string; quote?: string; status?: string; branchId?: string; assignedToId?: string; noteIsPublic?: boolean }
type OrderPart = { id: string; description: string; qty: number; unitCostCents: number; unitPriceCents: number; createdAt: string; status: "REQUESTED" | "APPROVED" | "REJECTED"; createdById?: string; decisionNote?: string | null; createdBy: { name: string }; product: { id: string; name: string; barcode: string | null } | null }
type Order = {
  id: string; number: number; version: number; status: RepairStage; customerName: string; customerPhone: string; quoteToken?: string;
  equipmentType: string; brand: string | null; model: string | null; serialNumber: string | null; accessories: string | null;
  equipmentColor: string | null; deviceAccessType: string | null; deviceAccessValue: string | null;
  intakeCondition: string | null; reportedIssue: string; serviceName?: string | null; diagnosis: string | null; quoteCents: number | null;
  approvedQuoteCents: number | null; diagnosticFeeCents: number | null; closedWithoutRepair?: boolean; currentBranch: Branch; intakeBranch: Branch; assignedTo: Branch | null; createdAt: string; promisedAt: string | null;
  scheduledAt: string | null; location: string | null; aesthetics: string | null; functionalConditions: string | null;
  payments?: WorkshopPayment[];
  events?: WorkshopEvent[];
  parts?: OrderPart[];
  // Constancia de entrega estructurada (quién recoge, su ID, firma y quién del
  // staff entregó). deliverySignatureData solo llega en el detalle, no en listas.
  deliveredTo?: string | null; deliveredToDoc?: string | null; deliverySignatureData?: string | null;
  deliveredBy?: { id: string; name: string } | null;
  uploadToken?: string;
  uploadTokenExpiresAt?: string | null;
  photos?: { id: string; label: string | null; createdAt: string; uploadedBy?: { name: string } | null }[];
}
const inputClass = "w-full rounded-lg border bg-background px-3 py-2 text-sm"
const money = (value: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(value / 100)
const date = (value: string) => new Date(value).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })

const activeBoardStages: RepairStage[] = ["RECEIVED", "DIAGNOSIS", "WAITING_APPROVAL", "WAITING_PARTS", "EXTERNAL_LAB", "IN_REPAIR", "QUALITY_CHECK", "READY"]
const closedColumnStages: RepairStage[] = ["DELIVERED", "NOT_REPAIRED", "NOT_AUTHORIZED", "CANCELLED", "WARRANTY"]
const boardStages: RepairStage[] = [...activeBoardStages, ...closedColumnStages]
const terminalStages: readonly RepairStage[] = ["DELIVERED", "CANCELLED"]
// Además de las cerradas, los cierres sin reparación ya no admiten refacciones
// (el dominio rechaza PART_* ahí): la sección se muestra solo lectura.
const partsClosedStages: readonly RepairStage[] = [...terminalStages, "NOT_AUTHORIZED", "NOT_REPAIRED"]
const closedColumnStyle = { dot: "bg-zinc-400", badge: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400" }
const viewTabs = [{ value: "board", label: "Tablero" }, { value: "today", label: "Entregar hoy" }, { value: "overdue", label: "Atrasadas" }, { value: "debt", label: "Con adeudo" }] as const
type BoardView = typeof viewTabs[number]["value"]
const stageStyles: Record<RepairStage, { dot: string; badge: string }> = {
  RECEIVED: { dot: "bg-sky-500", badge: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  DIAGNOSIS: { dot: "bg-violet-500", badge: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  WAITING_APPROVAL: { dot: "bg-amber-500", badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  WAITING_PARTS: { dot: "bg-orange-500", badge: "bg-orange-500/10 text-orange-700 dark:text-orange-300" },
  IN_REPAIR: { dot: "bg-blue-600", badge: "bg-blue-600/10 text-blue-700 dark:text-blue-300" },
  QUALITY_CHECK: { dot: "bg-teal-500", badge: "bg-teal-500/10 text-teal-700 dark:text-teal-300" },
  READY: { dot: "bg-emerald-500", badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  DELIVERED: { dot: "bg-zinc-400", badge: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400" },
  CANCELLED: { dot: "bg-rose-400", badge: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
  NOT_REPAIRED: { dot: "bg-red-500", badge: "bg-red-500/10 text-red-700 dark:text-red-300" },
  NOT_AUTHORIZED: { dot: "bg-pink-500", badge: "bg-pink-500/10 text-pink-700 dark:text-pink-300" },
  EXTERNAL_LAB: { dot: "bg-indigo-500", badge: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" },
  WARRANTY: { dot: "bg-cyan-500", badge: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" },
}
const accessLabels: Record<string, string> = { NONE: "Sin bloqueo", PATTERN: "Patrón", PIN: "PIN", PASSWORD: "Contraseña" }
const aestheticsLabels: Record<string, string> = { BUENO: "Bueno", REGULAR: "Regular", MALO: "Malo" }
const conditionLabels: Record<string, string> = { ENCENDIDO: "Encendido", APAGADO: "Apagado", MOJADO: "Mojado", MANIPULADO: "Manipulado", ROTO: "Roto", INCOMPLETO: "Incompleto" }
const isOverdue = (order: Order) => order.promisedAt !== null && new Date(order.promisedAt).getTime() < Date.now() && !terminalStages.includes(order.status)
const isScheduledToday = (order: Order) => {
  if (!order.scheduledAt) return false
  const scheduled = new Date(order.scheduledAt); const now = new Date()
  return scheduled.getFullYear() === now.getFullYear() && scheduled.getMonth() === now.getMonth() && scheduled.getDate() === now.getDate()
}

function PromisedAt({ order }: { order: Order }) {
  if (!order.promisedAt) return null
  const overdue = isOverdue(order)
  return <span className={`flex items-center gap-1 ${overdue ? "font-medium text-amber-600 dark:text-amber-400" : ""}`}><CalendarClock size={12} />{date(order.promisedAt)}{overdue ? " · Atrasada" : ""}</span>
}

function PatternDots({ value }: { value: string }) {
  const steps = value.split("-").map(Number)
  return <span className="mt-1 inline-grid grid-cols-3 gap-1" aria-label={`Patrón de desbloqueo ${value}`}>
    {Array.from({ length: 9 }, (_, index) => {
      const step = steps.indexOf(index)
      return <span key={index} className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${step >= 0 ? "border-primary bg-primary font-semibold text-primary-foreground" : "bg-muted"}`}>{step >= 0 ? step + 1 : ""}</span>
    })}
  </span>
}

function BoardColumn({ title, style, orders, total, dimmed, showStage, onOpen }: { title: string; style: { dot: string; badge: string }; orders: Order[]; total: number; dimmed?: boolean; showStage?: boolean; onOpen: (id: string) => void }) {
  return <section aria-label={title} className={`flex w-72 shrink-0 flex-col rounded-xl bg-muted/40 p-3 ${dimmed ? "opacity-70" : ""}`}>
    <header className="mb-3 flex items-center gap-2 px-1">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} />
      <h2 className="truncate text-sm font-semibold">{title}</h2>
      <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${style.badge}`}>{total}</span>
    </header>
    <div className="max-h-[65vh] space-y-2 overflow-y-auto pr-1">
      {orders.length === 0 ? <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">Sin órdenes</p>
        : orders.map(order => <button key={order.id} onClick={() => onOpen(order.id)} className="w-full space-y-1.5 rounded-lg border bg-card p-3 text-left text-sm transition hover:border-primary focus-visible:outline-2 focus-visible:outline-primary">
          <p className="flex items-center justify-between gap-2"><strong className="text-xs text-muted-foreground">{repairFolio(order.number)}</strong>{showStage && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${stageStyles[order.status].badge}`}>{repairLabels[order.status]}</span>}</p>
          <p className="font-medium leading-snug">{[order.equipmentType, order.brand, order.model].filter(Boolean).join(" · ")}</p>
          <p className="text-xs text-muted-foreground">{order.customerName}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><MapPin size={12} />{order.currentBranch.name}</span>
            <span className="flex items-center gap-1"><Wrench size={12} />{order.assignedTo?.name ?? "Sin asignar"}</span>
            <PromisedAt order={order} />
          </div>
          {(orderBalanceCents(order) > 0 || isScheduledToday(order) || order.location) && <div className="flex flex-wrap gap-1.5 pt-0.5">
            {orderBalanceCents(order) > 0 && <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-300">Adeudo {money(orderBalanceCents(order))}</span>}
            {isScheduledToday(order) && <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300">Hoy</span>}
            {order.location && <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"><MapPin size={11} />{order.location}</span>}
          </div>}
        </button>)}
      {total > orders.length && <p className="px-1 pt-2 text-xs text-muted-foreground">Hay {total - orders.length} más. Usa el filtro de etapa para verlas.</p>}
    </div>
  </section>
}

export default function WorkshopPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "ADMIN"
  const currentUserId = session?.user?.id ?? null
  const [orders, setOrders] = useState<Order[]>([])
  const [board, setBoard] = useState<{ orders: Record<RepairStage, Order[]>; totals: Record<RepairStage, number> } | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [staff, setStaff] = useState<Branch[]>([])
  const [branch, setBranch] = useState(() => typeof window === "undefined" ? "" : localStorage.getItem("reficio-branch") ?? "")
  const [stage, setStage] = useState("")
  const [view, setView] = useState<BoardView>("board")
  const [search, setSearch] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("q")?.slice(0, 100) ?? "")
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState<Order | null>(null)
  const [evidenceLinkExpired, setEvidenceLinkExpired] = useState(false)
  const [saving, setSaving] = useState(false)
  const [action, setAction] = useState("NOTE")
  const [drafts, setDrafts] = useState<Record<string, ActionDraft>>({})
  const [paymentForm, setPaymentForm] = useState<PaymentForm>(emptyPaymentForm)
  const [refundForm, setRefundForm] = useState<RefundForm>(emptyRefundForm)
  const [feeDraft, setFeeDraft] = useState("")
  const [settleForm, setSettleForm] = useState<SettleForm>(emptySettleForm)
  const [settleOpen, setSettleOpen] = useState(false)
  const [planForm, setPlanForm] = useState<PlanForm>({ scheduledAt: "", location: "" })
  const [showAccess, setShowAccess] = useState(false)
  const [discardDialog, setDiscardDialog] = useState(false)
  const [opening, setOpening] = useState(false)
  const operationKey = useRef<ClientOperationKey | null>(null)
  const inFlight = useRef(false)
  const requestVersion = useRef(0)
  const detailVersion = useRef(0)
  const detailRequest = useRef<AbortController | null>(null)
  const draft = drafts[action] ?? {}
  const kanbanMode = view === "board" && !stage && !search
  const selectedParts = selected?.parts ?? []
  // No hay deliveredAt dedicado: la fecha exacta la conserva el evento público
  // de entrega (updatedAt cambiaría con una garantía o reembolso posterior).
  const deliveredAt = selected?.events?.find(event => event.type === "STATUS" && event.detail.includes("Entrega registrada"))?.createdAt
  // Desglose para "Enviar cotización" por WhatsApp: mano de obra + refacciones aprobadas.
  const quoteShare = (o: Order) => {
    const labor = o.approvedQuoteCents ?? o.quoteCents
    if (labor === null) return undefined
    const approved = (o.parts ?? []).filter(p => p.status === "APPROVED")
    return {
      equipment: [o.equipmentType, o.brand, o.model].filter(Boolean).join(" "),
      token: o.quoteToken,
      lines: [
        { label: "Mano de obra / diagnóstico", amount: labor / 100 },
        ...approved.map(p => ({ label: `${p.description} ×${p.qty}`, amount: (p.unitPriceCents * p.qty) / 100 })),
      ],
      total: (labor + approved.reduce((sum, p) => sum + p.unitPriceCents * p.qty, 0)) / 100,
    }
  }
  const paymentFormDirty = paymentForm.amount !== "" || paymentForm.method !== "" || paymentForm.note !== ""
  const refundFormDirty = refundForm.amount !== "" || refundForm.method !== "" || refundForm.note !== ""
  const feeDraftDirty = selected !== null && feeDraft !== (selected.diagnosticFeeCents === null ? "" : String(selected.diagnosticFeeCents / 100))
  // El nombre de quien recoge se prellena con el titular al abrir el panel:
  // solo cuenta como cambio si difiere del prellenado.
  const settleFormDirty = settleOpen && (settleForm.method !== "" || settleForm.deliveredTo !== (selected?.customerName ?? "") || settleForm.deliveredToDoc !== "" || settleForm.deliverySignatureData !== null)
  const planFormDirty = selected !== null && (planForm.scheduledAt !== toLocalInput(selected.scheduledAt) || planForm.location !== (selected.location ?? ""))
  const hasUnsavedChanges = paymentFormDirty || refundFormDirty || feeDraftDirty || settleFormDirty || planFormDirty || Object.values(drafts).some(value => Object.values(value).some(field => (typeof field === "string" && field !== "") || field === true))
  const updateDraft = (changes: ActionDraft) => setDrafts(previous => ({ ...previous, [action]: { ...previous[action], ...changes } }))
  // SignaturePad emite onChange tras cada render si el handler cambia; el
  // bail-out por valor evita un ciclo de render infinito (mismo patrón que
  // la firma de recepción en recibir).
  const handleSettleChange = useCallback((form: SettleForm) => {
    setSettleForm(previous =>
      previous.method === form.method && previous.deliveredTo === form.deliveredTo &&
      previous.deliveredToDoc === form.deliveredToDoc && previous.deliverySignatureData === form.deliverySignatureData
        ? previous : form)
  }, [])

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

  function syncOrderUrl(id: string | null, replace = false) {
    const url = new URL(window.location.href)
    if (id) url.searchParams.set("orden", id)
    else url.searchParams.delete("orden")
    if (replace) window.history.replaceState(null, "", url)
    else window.history.pushState(null, "", url)
  }

  function closeOrder() {
    detailVersion.current += 1
    detailRequest.current?.abort()
    detailRequest.current = null
    setOpening(false); setSelected(null); setAction("NOTE")
    setDrafts({}); setPaymentForm(emptyPaymentForm); setRefundForm(emptyRefundForm); setFeeDraft(""); setSettleForm(emptySettleForm)
    setSettleOpen(false); setPlanForm({ scheduledAt: "", location: "" })
    setShowAccess(false); setDiscardDialog(false)
  }

  function backToOrders() {
    closeOrder()
    if (new URLSearchParams(window.location.search).get("orden")) syncOrderUrl(null)
  }
  const load = useCallback(async () => {
    const version = ++requestVersion.current
    setLoading(true); setError("")
    try {
      if (view === "board" && !stage && !search) {
        const results = await Promise.all(boardStages.map(async status => {
          const params = new URLSearchParams({ branchId: branch, status, page: "1" })
          const response = await fetch(`/api/workshop?${params}`)
          const data = await response.json()
          if (!response.ok) throw new Error(data.error || "No se pudieron cargar las órdenes")
          return data
        }))
        if (version !== requestVersion.current) return
        const boardOrders = {} as Record<RepairStage, Order[]>
        const boardTotals = {} as Record<RepairStage, number>
        boardStages.forEach((status, index) => { boardOrders[status] = results[index].orders; boardTotals[status] = results[index].total })
        setBoard({ orders: boardOrders, totals: boardTotals })
        setBranches(results[0].branches); setStaff(results[0].staff)
        setTotal(results.reduce((sum, data) => sum + data.total, 0))
      } else {
        const params = new URLSearchParams({ q: search, branchId: branch, status: stage, page: String(page) })
        if (view !== "board") params.set("view", view)
        const response = await fetch(`/api/workshop?${params}`)
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "No se pudieron cargar las órdenes")
        if (version !== requestVersion.current) return
        setOrders(data.orders); setBranches(data.branches); setStaff(data.staff); setPages(data.totalPages); setTotal(data.total)
      }
    } catch (cause) { if (version === requestVersion.current) setError(cause instanceof Error ? cause.message : "Error de conexión") }
    finally { if (version === requestVersion.current) setLoading(false) }
  }, [branch, page, search, stage, view])
  useEffect(() => { const timer = setTimeout(() => { void load() }, 200); return () => clearTimeout(timer) }, [load])

  async function openOrder(id: string, preserveDrafts = false, push = true) {
    if (push && new URLSearchParams(window.location.search).get("orden") !== id) syncOrderUrl(id)
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
      if (!preserveDrafts || selected?.id !== order.id || terminalStages.includes(order.status)) {
        setDrafts({}); setAction("NOTE")
      } else {
        // Authorization text belongs to the specific quote the operator reviewed.
        if (selected.quoteCents !== order.quoteCents || order.status !== "WAITING_APPROVAL") {
          setDrafts(previous => { const next = { ...previous }; delete next.APPROVE; return next })
        }
        const available = ["NOTE", "ASSIGN", "TRANSFER", ...(repairNextStages[order.status].length ? ["STATUS"] : []), ...(["DIAGNOSIS", "WAITING_APPROVAL"].includes(order.status) ? ["QUOTE"] : []), ...(order.status === "WAITING_APPROVAL" ? ["APPROVE"] : [])]
        if (!available.includes(action)) setAction("NOTE")
      }
      setSelected(order); setPaymentForm(emptyPaymentForm); setRefundForm(emptyRefundForm); setSettleForm(emptySettleForm); setSettleOpen(false)
      // Vigencia del link de evidencias se evalúa al cargar la orden (no en render).
      setEvidenceLinkExpired(Boolean(order.uploadTokenExpiresAt && new Date(order.uploadTokenExpiresAt).getTime() < Date.now()))
      setFeeDraft(order.diagnosticFeeCents === null ? "" : String(order.diagnosticFeeCents / 100))
      setPlanForm({ scheduledAt: toLocalInput(order.scheduledAt), location: order.location ?? "" }); setShowAccess(false)
    } catch {
      if (!controller.signal.aborted && version === detailVersion.current) toast.error("No se pudo abrir la orden. Intenta de nuevo.")
    } finally {
      if (version === detailVersion.current) { setOpening(false); detailRequest.current = null }
    }
  }
  // La orden abierta vive en la URL (?orden=<id>): el botón "atrás" del
  // navegador regresa a la lista y el detalle se puede enlazar/recargar.
  useEffect(() => {
    const fromUrl = () => new URLSearchParams(window.location.search).get("orden")
    const initial = fromUrl()
    // Diferido: el estado inicial de la orden se carga fuera del ciclo del effect.
    const timer = setTimeout(() => { if (initial) void openOrder(initial, false, false) }, 0)
    const onPop = () => {
      const id = fromUrl()
      if (id) void openOrder(id, false, false)
      else closeOrder()
    }
    window.addEventListener("popstate", onPop)
    return () => { clearTimeout(timer); window.removeEventListener("popstate", onPop) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  async function post(url: string, payload: Record<string, unknown>) {
    operationKey.current = getClientOperationKey(operationKey.current, { url, ...payload })
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, idempotencyKey: operationKey.current.key }) })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || "No se confirmó el cambio")
    operationKey.current = null
    return data
  }
  async function submit(event: React.FormEvent<HTMLFormElement>, kind: "branch" | "update") {
    event.preventDefault()
    if (inFlight.current || opening) return
    inFlight.current = true; setSaving(true)
    const form = event.currentTarget
    const fields = Object.fromEntries(new FormData(form).entries()) as Record<string, string>
    try {
      if (kind === "branch") {
        await post("/api/workshop", { action: "CREATE_BRANCH", name: fields.name }); form.reset(); await load()
      } else if (selected) {
        const quote = fields.quote === undefined ? undefined : Number(fields.quote)
        if (quote !== undefined && (!Number.isFinite(quote) || quote < 0 || Math.abs(quote * 100 - Math.round(quote * 100)) > 0.000001)) throw new Error("El presupuesto admite hasta dos decimales")
        const result = await post(`/api/workshop/${selected.id}`, { action: fields.action ?? action, expectedVersion: selected.version, detail: fields.detail, status: fields.status, branchId: fields.branchId, assignedToId: fields.assignedToId, quoteCents: quote === undefined ? undefined : Math.round(quote * 100), noteIsPublic: fields.noteIsPublic === "on" })
        setDrafts(previous => {
          const next = { ...previous }
          delete next[action]
          if (action === "QUOTE") delete next.APPROVE
          return next
        })
        form.reset(); await openOrder(selected.id, true); await load()
        if (result?.notifyWhatsApp) toast.success("Orden lista", { action: { label: "Avisar por WhatsApp", onClick: () => window.open(result.notifyWhatsApp, "_blank", "noopener") }, duration: 10000 })
      }
      toast.success("Cambio guardado")
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "No se confirmó el cambio. Reintenta sin cambiar los datos.") }
    finally { inFlight.current = false; setSaving(false) }
  }
  async function handlePartAction(payload: PartActionPayload) {
    if (inFlight.current || opening || !selected) return
    inFlight.current = true; setSaving(true)
    try {
      await post(`/api/workshop/${selected.id}`, payload)
      await openOrder(selected.id, true); await load()
      toast.success(payload.action === "PART_DECIDE" ? "Decisión registrada" : payload.action === "PART_REMOVE" ? "Refacción retirada" : "Refacción registrada")
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "No se confirmó el cambio. Reintenta sin cambiar los datos."); throw cause }
    finally { inFlight.current = false; setSaving(false) }
  }
  async function submitPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || opening || !selected) return
    const amount = Number(paymentForm.amount)
    inFlight.current = true; setSaving(true)
    try {
      if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) throw new Error("El abono debe ser mayor a cero y admite hasta dos decimales")
      if (!["CASH", "CARD", "TRANSFER"].includes(paymentForm.method)) throw new Error("Selecciona el método de cobro.")
      await post(`/api/workshop/${selected.id}`, { action: "PAYMENT", expectedVersion: selected.version, paymentCents: Math.round(amount * 100), paymentMethod: paymentForm.method, detail: paymentForm.note.trim() || undefined })
      setPaymentForm(emptyPaymentForm)
      await openOrder(selected.id, true); await load()
      toast.success("Abono registrado")
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "No se confirmó el cambio. Reintenta sin cambiar los datos.") }
    finally { inFlight.current = false; setSaving(false) }
  }
  async function submitRefund(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || opening || !selected) return
    const amount = Number(refundForm.amount)
    inFlight.current = true; setSaving(true)
    try {
      if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) throw new Error("La devolución debe ser mayor a cero y admite hasta dos decimales")
      if (!["CASH", "CARD", "TRANSFER"].includes(refundForm.method)) throw new Error("Selecciona el método de devolución.")
      await post(`/api/workshop/${selected.id}`, { action: "REFUND", expectedVersion: selected.version, paymentCents: Math.round(amount * 100), paymentMethod: refundForm.method, detail: refundForm.note.trim() || "Devolución de excedente" })
      setRefundForm(emptyRefundForm)
      await openOrder(selected.id, true); await load()
      toast.success("Reembolso registrado")
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "No se confirmó el cambio. Reintenta sin cambiar los datos.") }
    finally { inFlight.current = false; setSaving(false) }
  }
  async function submitFee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || opening || !selected) return
    const fee = Number(feeDraft)
    inFlight.current = true; setSaving(true)
    try {
      if (!Number.isFinite(fee) || fee < 0 || Math.abs(fee * 100 - Math.round(fee * 100)) > 0.000001) throw new Error("El cargo admite hasta dos decimales")
      await post(`/api/workshop/${selected.id}`, { action: "DIAGNOSTIC_FEE", expectedVersion: selected.version, diagnosticFeeCents: Math.round(fee * 100) })
      await openOrder(selected.id, true); await load()
      toast.success("Cargo de diagnóstico guardado")
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "No se confirmó el cambio. Reintenta sin cambiar los datos.") }
    finally { inFlight.current = false; setSaving(false) }
  }
  async function submitSettle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || opening || !selected) return
    const deliveredTo = settleForm.deliveredTo.trim()
    const deliveredToDoc = settleForm.deliveredToDoc.trim()
    const balance = orderBalanceCents(selected)
    inFlight.current = true; setSaving(true)
    try {
      if (deliveredTo.length < 2) throw new Error("Indica el nombre de quien recoge el equipo.")
      if (balance > 0 && !["CASH", "CARD", "TRANSFER"].includes(settleForm.method)) throw new Error("Selecciona el método de cobro del saldo.")
      await post(`/api/workshop/${selected.id}`, {
        action: "SETTLE_DELIVER", expectedVersion: selected.version,
        paymentMethod: balance > 0 ? settleForm.method : undefined,
        deliveredTo,
        deliveredToDoc: deliveredToDoc || undefined,
        deliverySignatureData: settleForm.deliverySignatureData ?? undefined,
      })
      setSettleForm(emptySettleForm); setSettleOpen(false)
      await openOrder(selected.id, true); await load()
      toast.success("Entrega registrada")
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "No se confirmó el cambio. Reintenta sin cambiar los datos.") }
    finally { inFlight.current = false; setSaving(false) }
  }
  async function submitPlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || opening || !selected) return
    inFlight.current = true; setSaving(true)
    try {
      await post(`/api/workshop/${selected.id}`, { action: "PLAN", expectedVersion: selected.version, scheduledAt: planForm.scheduledAt ? new Date(planForm.scheduledAt).toISOString() : null, location: planForm.location.trim() || null })
      await openOrder(selected.id, true); await load()
      toast.success("Plan actualizado")
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "No se confirmó el cambio. Reintenta sin cambiar los datos.") }
    finally { inFlight.current = false; setSaving(false) }
  }
  // Regenerar el link público de evidencias (QR del sticker): acción solo
  // admin — el dominio rota el token y los enlaces/QR anteriores mueren.
  async function rotateUploadToken() {
    if (inFlight.current || opening || !selected || !isAdmin) return
    if (!window.confirm("¿Regenerar el link de evidencias? Los códigos QR y enlaces anteriores dejarán de funcionar.")) return
    inFlight.current = true; setSaving(true)
    try {
      await post(`/api/workshop/${selected.id}`, { action: "ROTATE_UPLOAD_TOKEN", expectedVersion: selected.version })
      await openOrder(selected.id, true); await load()
      toast.success("Link de evidencias regenerado")
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "No se confirmó el cambio. Reintenta sin cambiar los datos.") }
    finally { inFlight.current = false; setSaving(false) }
  }

  const emptyList = <div className="rounded-xl border border-dashed p-12 text-center"><ClipboardList className="mx-auto mb-3 h-10 w-10 text-muted-foreground" /><h2 className="text-lg font-semibold">{total === 0 && !search && !stage && !branch && view === "board" ? "Todo listo para la primera recepción" : "No hay órdenes con estos filtros"}</h2><p className="mt-2 text-muted-foreground">{branches.length ? "Usa Recibir equipo para comenzar." : "Registra abajo las sucursales del taller."}</p></div>

  return <div className="mx-auto max-w-6xl space-y-6 pb-20">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="text-sm font-medium text-primary"><BusinessName fallback="ProSolutions" /> · Taller</p><h1 className="mt-1 text-3xl font-bold">{selected ? repairFolio(selected.number) : "Órdenes de servicio"}</h1><p className="mt-2 text-muted-foreground">{selected ? `${selected.customerName} · ${selected.equipmentType}` : "De la recepción a la entrega, con un historial por equipo."}</p></div>
      {selected || opening ? <div className="flex flex-wrap items-center gap-2">
        {selected && <><ShareRepairOrder folio={repairFolio(selected.number)} phone={selected.customerPhone} quote={quoteShare(selected)} /><Button variant="outline" asChild><Link href={`/admin/tickets/reparacion/${selected.id}`} target="_blank" rel="noopener noreferrer"><Printer className="mr-2 h-4 w-4" />Ticket cliente</Link></Button><Button variant="outline" asChild><Link href={`/admin/tickets/taller/${selected.id}`} target="_blank" rel="noopener noreferrer"><Wrench className="mr-2 h-4 w-4" />Hoja de taller</Link></Button><Button variant="outline" asChild><Link href={`/admin/tickets/cotizacion/${selected.id}`} target="_blank" rel="noopener noreferrer"><FileText className="mr-2 h-4 w-4" />Cotización</Link></Button></>}
        <Button variant="outline" disabled={saving} onClick={() => { if (hasUnsavedChanges) setDiscardDialog(true); else backToOrders() }}><ArrowLeft className="mr-2 h-4 w-4" />Volver a órdenes</Button>
      </div>
        : <div className="flex items-center gap-2"><ExportButton type="orders" branchId={branch || undefined} /><Button disabled={!branches.length || loading} onClick={() => router.push("/admin/taller/recibir")}><Plus className="mr-2 h-4 w-4" />Recibir equipo</Button></div>}
    </div>
    {opening && <p role="status" aria-live="polite" className="text-sm text-muted-foreground">Abriendo orden…</p>}
    {error && <div role="alert" className="rounded-lg border p-4 text-destructive">{error}<Button variant="outline" className="ml-3" onClick={() => void load()}>Reintentar</Button></div>}
    {!selected && <>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Vistas del taller">{viewTabs.map(tab => <button key={tab.value} type="button" role="tab" aria-selected={view === tab.value} onClick={() => { setView(tab.value); setPage(1) }} className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${view === tab.value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}>{tab.label}</button>)}</div>
      <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-3">
        <label className="text-sm">Buscar folio, cliente, teléfono, modelo o serie<div className="relative mt-2"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input value={search} className="pl-9" placeholder="OT-000001, teléfono o modelo…" onChange={e => { setSearch(e.target.value); setPage(1) }} /></div></label>
        <label className="text-sm">Ubicación actual<select className={`${inputClass} mt-2`} value={branch} onChange={e => { setBranch(e.target.value); setPage(1) }}><option value="">Todas las sucursales</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label className="text-sm">Etapa<select className={`${inputClass} mt-2`} value={stage} onChange={e => { setStage(e.target.value); setPage(1) }}><option value="">Todas las etapas</option>{Object.entries(repairLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      {loading ? <p role="status">Cargando órdenes…</p> : kanbanMode ? (total === 0 ? emptyList : <div className="space-y-3">
        <div className="flex items-start gap-3 overflow-x-auto pb-2">{activeBoardStages.map(value => <BoardColumn key={value} title={repairLabels[value]} style={stageStyles[value]} orders={board?.orders[value] ?? []} total={board?.totals[value] ?? 0} onOpen={id => void openOrder(id)} />)}
          <BoardColumn title="Cerradas" style={closedColumnStyle} dimmed showStage onOpen={id => void openOrder(id)}
            orders={board ? closedColumnStages.flatMap(value => board.orders[value] ?? []).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 20) : []}
            total={board ? closedColumnStages.reduce((sum, value) => sum + (board.totals[value] ?? 0), 0) : 0} />
        </div>
        <p className="text-xs text-muted-foreground">{total} órdenes{board && boardStages.some(value => board.totals[value] > board.orders[value].length) ? " · Cada columna muestra hasta 20; usa el filtro de etapa para ver el resto." : ""}</p>
      </div>) : orders.length === 0 ? emptyList : <div className="grid gap-3 md:grid-cols-2">{orders.map(order => <button key={order.id} onClick={() => void openOrder(order.id)} className="space-y-3 rounded-xl border bg-card p-5 text-left transition hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"><div className="flex justify-between gap-3"><strong>{repairFolio(order.number)}</strong><span className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">{repairLabels[order.status]}</span></div><div><h2 className="font-semibold">{[order.equipmentType, order.brand, order.model].filter(Boolean).join(" · ")}</h2><p className="text-sm text-muted-foreground">{order.customerName}</p></div><p className="line-clamp-2 text-sm">{order.reportedIssue}</p><div className="flex flex-wrap gap-3 text-xs text-muted-foreground"><span className="flex items-center gap-1"><MapPin size={14} />{order.currentBranch.name}</span><span className="flex items-center gap-1"><Wrench size={14} />{order.assignedTo?.name ?? "Sin asignar"}</span><span className="flex items-center gap-1"><Clock3 size={14} />{date(order.createdAt)}</span><PromisedAt order={order} /></div></button>)}</div>}
      {!kanbanMode && <div className="flex items-center justify-between text-sm"><span>{total} órdenes · Página {page} de {pages}</span><div className="flex gap-2"><Button variant="outline" disabled={page === 1 || loading} onClick={() => setPage(p => p - 1)}>Anterior</Button><Button variant="outline" disabled={page >= pages || loading} onClick={() => setPage(p => p + 1)}>Siguiente</Button></div></div>}
      <details className="rounded-xl border bg-card p-4"><summary className="cursor-pointer font-medium">Sucursales del taller ({branches.length})</summary><p className="my-3 text-sm text-muted-foreground">{branches.map(b => b.name).join(" · ") || "Todavía no hay sucursales."} Las ubicaciones de equipos se administran aquí y en Sucursales; el inventario es independiente por sucursal.</p><form onSubmit={e => void submit(e, "branch")} className="flex max-w-md gap-2"><Input name="name" aria-label="Nombre de la sucursal" required minLength={2} maxLength={80} placeholder="Nombre de la sucursal" /><Button disabled={saving}>Agregar</Button></form></details>
    </>}
    {selected && <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]"><div className="space-y-5"><section className="space-y-4 rounded-xl border bg-card p-5"><div className="flex justify-between"><h2 className="font-semibold">Equipo y recepción</h2><span className="text-sm text-primary">{repairLabels[selected.status]}</span></div><p>{[selected.equipmentType, selected.brand, selected.model].filter(Boolean).join(" · ")}</p><dl className="grid gap-3 text-sm"><div><dt className="text-muted-foreground">Servicio</dt><dd>{selected.serviceName || "Sin registrar"}</dd></div><div><dt className="text-muted-foreground">Falla reportada</dt><dd>{selected.reportedIssue}</dd></div>{[["Serie / IMEI", selected.serialNumber], ["Color", selected.equipmentColor], ["Estado físico", selected.intakeCondition], ["Estética", aestheticsLabels[selected.aesthetics ?? ""] ?? null], ["Accesorios", selected.accessories], ["Contacto", `${selected.customerName} · ${selected.customerPhone}`], ["Recibido en", selected.intakeBranch.name], ["Ubicación actual", selected.currentBranch.name], ["Responsable", selected.assignedTo?.name ?? "Sin asignar"], ["Entrega prometida", selected.promisedAt ? date(selected.promisedAt) : null], ...(selected.deliveredTo ? [["Entregado a", selected.deliveredTo], ["Identificación", selected.deliveredToDoc ?? ""], ["Entregó (staff)", selected.deliveredBy?.name ?? ""], ["Fecha de entrega", deliveredAt ? date(deliveredAt) : ""]] : [])].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd>{value || "Sin registrar"}</dd></div>)}<div><dt className="text-muted-foreground">Condiciones</dt><dd>{selected.functionalConditions ? <span className="mt-1 flex flex-wrap gap-1.5">{selected.functionalConditions.split(",").filter(Boolean).map(flag => <span key={flag} className="rounded-full bg-muted px-2 py-0.5 text-xs">{conditionLabels[flag] ?? flag}</span>)}</span> : "Sin registrar"}</dd></div><div><dt className="text-muted-foreground">Bloqueo</dt><dd>{accessLabels[selected.deviceAccessType ?? ""] ?? "Sin registrar"}{selected.deviceAccessValue && <><button type="button" onClick={() => setShowAccess(value => !value)} className="ml-2 inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline">{showAccess ? <><EyeOff size={12} />Ocultar</> : <><Eye size={12} />Mostrar</>}</button>{showAccess && <code className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">{selected.deviceAccessValue}</code>}{showAccess && selected.deviceAccessType === "PATTERN" && <PatternDots value={selected.deviceAccessValue} />}</>}</dd></div>{selected.deliverySignatureData && <div><dt className="text-muted-foreground">Firma de quien recibió</dt><dd>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={selected.deliverySignatureData} alt="Firma de quien recibió el equipo" className="mt-1 h-20 rounded border bg-white object-contain" /></dd></div>}</dl></section>
      <PartsSection order={{ id: selected.id, version: selected.version, parts: selectedParts }}
        canDecide={isAdmin} currentUserId={currentUserId} busy={saving || opening}
        readOnly={partsClosedStages.includes(selected.status)}
        onAction={async payload => { await handlePartAction(payload) }} />
      <section className="space-y-3 rounded-xl border bg-card p-5"><h2 className="font-semibold">Diagnóstico y presupuesto</h2><p className="whitespace-pre-wrap text-sm">{selected.diagnosis || "Pendiente de diagnóstico"}</p><p className="text-2xl font-semibold">{selected.quoteCents === null ? "Sin cotizar" : money(selected.quoteCents)}</p><p className="text-sm text-muted-foreground">{selected.approvedQuoteCents === null ? "Sin autorización registrada" : `Autorizado: ${money(selected.approvedQuoteCents)}`}</p></section>
      <PaymentsPanel status={selected.status} quoteCents={selected.quoteCents} approvedQuoteCents={selected.approvedQuoteCents} diagnosticFeeCents={selected.diagnosticFeeCents}
        closedWithoutRepair={selected.closedWithoutRepair} parts={selectedParts} payments={selected.payments}
        canCharge={!terminalStages.includes(selected.status)} canDeliver={repairDeliverableStages.includes(selected.status)} canRefund={isAdmin} disabled={saving || opening}
        paymentForm={paymentForm} onPaymentChange={setPaymentForm} onPaymentSubmit={e => void submitPayment(e)}
        settleOpen={settleOpen} onSettleOpenChange={open => { if (open) setSettleForm({ ...emptySettleForm, deliveredTo: selected.customerName }); setSettleOpen(open) }}
        settleForm={settleForm} onSettleChange={handleSettleChange} onSettleSubmit={e => void submitSettle(e)}
        feeDraft={feeDraft} onFeeChange={setFeeDraft} onFeeSubmit={e => void submitFee(e)}
        refundForm={refundForm} onRefundChange={setRefundForm} onRefundSubmit={e => void submitRefund(e)} />
      <WorkPlan scheduledAt={selected.scheduledAt} location={selected.location} editable={!terminalStages.includes(selected.status)} disabled={saving || opening}
        form={planForm} onChange={setPlanForm} onSubmit={e => void submitPlan(e)} />
      <EvidenceSection order={{ id: selected.id, uploadToken: selected.uploadToken, photos: selected.photos ?? [] }}
        // El enlace público solo sube en órdenes abiertas: la ruta rechaza
        // los mismos estados que cierran refacciones; si el token venció el
        // admin puede regenerarlo desde la misma sección.
        linkState={partsClosedStages.includes(selected.status) ? "closed" : (evidenceLinkExpired ? "expired" : "active")}
        onRotateLink={isAdmin ? () => void rotateUploadToken() : undefined}
        rotateBusy={saving || opening}
        onChanged={() => void openOrder(selected.id, true)} />
      {(!terminalStages.includes(selected.status) || selected.status === "DELIVERED") && <form onSubmit={e => void submit(e, "update")} className="space-y-4 rounded-xl border bg-card p-5"><h2 className="font-semibold">{selected.status === "DELIVERED" ? "Reabrir por garantía" : "Siguiente acción"}</h2><fieldset disabled={saving || opening} className="space-y-4">{selected.status === "DELIVERED" && <><input type="hidden" name="action" value="STATUS" /><input type="hidden" name="status" value="WARRANTY" /> </>}{selected.status !== "DELIVERED" && <label className="block text-sm">Acción<select value={action} onChange={e => setAction(e.target.value)} className={`${inputClass} mt-2`}><option value="NOTE">Agregar nota interna</option>{repairNextStages[selected.status].length > 0 && <option value="STATUS">Cambiar etapa</option>}{['DIAGNOSIS', 'WAITING_APPROVAL'].includes(selected.status) && <option value="QUOTE">Registrar diagnóstico y presupuesto</option>}{selected.status === 'WAITING_APPROVAL' && <option value="APPROVE">Registrar autorización del cliente</option>}<option value="ASSIGN">Asignar responsable</option><option value="TRANSFER">Registrar llegada a otra sucursal</option></select></label>}
      {selected.status !== "DELIVERED" && action === "STATUS" && <label className="block text-sm">Nueva etapa<select name="status" value={draft.status ?? repairNextStages[selected.status][0] ?? ""} onChange={e => updateDraft({ status: e.target.value })} className={`${inputClass} mt-2`}>{repairNextStages[selected.status].map(value => <option key={value} value={value}>{repairLabels[value]}</option>)}</select></label>}      {action === "QUOTE" && <label className="block text-sm">Importe total en MXN<Input name="quote" type="number" min={0} max={1000000} step="0.01" required value={draft.quote ?? (selected.quoteCents === null ? "" : String(selected.quoteCents / 100))} onChange={e => updateDraft({ quote: e.target.value })} /></label>}
      {action === "ASSIGN" && <label className="block text-sm">Responsable técnico<select name="assignedToId" required value={draft.assignedToId ?? ""} onChange={e => updateDraft({ assignedToId: e.target.value })} className={`${inputClass} mt-2`}><option value="">Selecciona una persona</option>{staff.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}
      {action === "TRANSFER" && <label className="block text-sm">Sucursal donde se recibió el equipo<select name="branchId" required value={draft.branchId ?? ""} onChange={e => updateDraft({ branchId: e.target.value })} className={`${inputClass} mt-2`}><option value="">Selecciona la sucursal destino</option>{branches.filter(b => b.id !== selected.currentBranch.id).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
      <label className="block text-sm">{action === "APPROVE" ? "Quién autorizó y por qué medio" : action === "QUOTE" ? "Diagnóstico y alcance del trabajo" : "Detalle de la acción"}<textarea name="detail" value={draft.detail ?? ""} onChange={e => updateDraft({ detail: e.target.value })} required maxLength={2000} rows={3} className={`${inputClass} mt-2`} placeholder={action === "STATUS" ? "Para entregar: quién recibe. Para listo: resultado de la revisión final." : "Deja contexto para la siguiente persona que atienda la orden."} /></label>{action === "NOTE" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="noteIsPublic" checked={draft.noteIsPublic ?? false} onChange={e => updateDraft({ noteIsPublic: e.target.checked })} className="h-4 w-4 rounded border" />Visible para el cliente en el rastreo</label>}<p className="text-xs text-muted-foreground">Cada acción conserva su propio borrador hasta guardarlo o salir de la orden.</p><Button disabled={saving || opening}>{saving ? "Guardando…" : "Guardar cambio"}</Button><Button variant="outline" type="button" disabled={saving || opening} onClick={() => void openOrder(selected.id, true)}>Actualizar orden</Button></fieldset></form>}
      </div><OrderHistory events={selected.events} folio={repairFolio(selected.number)} phone={selected.customerPhone} /></div>}
    <AlertDialog open={discardDialog} onOpenChange={setDiscardDialog}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>¿Descartar los cambios sin guardar?</AlertDialogTitle><AlertDialogDescription>Los borradores de acciones y de refacciones que no guardaste se perderán al volver a la lista.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Seguir editando</AlertDialogCancel><AlertDialogAction onClick={backToOrders}>Descartar y volver</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
}
