"use client"

import { Suspense, useState, useEffect, useRef, useCallback } from "react"
import { useSession } from "next-auth/react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import { formatPrice, formatDate, formatDay } from "@/lib/utils"
import {
    Wallet,
    ArrowUpCircle,
    ArrowDownCircle,
    Lock,
    Unlock,
    History,
    ReceiptText,
    Check,
    X,
    Printer,
    Coins,
    Banknote,
    CalendarDays,
    ExternalLink,
    Truck
} from "lucide-react"
import { LesDeboPanel } from "@/components/admin/caja/les-debo-panel"

type PaymentMethod = "CASH" | "CARD" | "TRANSFER" | "CREDIT"

const METHOD_LABELS: Record<string, string> = {
    CASH: "Efectivo", CARD: "Tarjeta", TRANSFER: "Transferencia", CREDIT: "Crédito",
}

// Centro de dinero: pestañas controladas por ?tab= (deep-link). Sin param = Caja.
const CAJA_TABS = ["caja", "solicitudes", "proveedores"] as const
type CajaTab = (typeof CAJA_TABS)[number]

// Misma whitelist que el servidor (domain/cash.ts): denominaciones MXN del
// conteo físico. Se duplica aquí porque la página es cliente y el dominio
// jala Prisma/node (no importable desde el bundle del navegador).
const DENOMINATIONS: { key: string; cents: number; label: string; kind: "bill" | "coin" }[] = [
    { key: "1000", cents: 100000, label: "$1,000", kind: "bill" },
    { key: "500", cents: 50000, label: "$500", kind: "bill" },
    { key: "200", cents: 20000, label: "$200", kind: "bill" },
    { key: "100", cents: 10000, label: "$100", kind: "bill" },
    { key: "50", cents: 5000, label: "$50", kind: "bill" },
    { key: "20", cents: 2000, label: "$20", kind: "bill" },
    { key: "10", cents: 1000, label: "$10", kind: "coin" },
    { key: "5", cents: 500, label: "$5", kind: "coin" },
    { key: "2", cents: 200, label: "$2", kind: "coin" },
    { key: "1", cents: 100, label: "$1", kind: "coin" },
    { key: "0.5", cents: 50, label: "$0.50", kind: "coin" },
]

interface Movement {
    id: string
    type: "IN" | "OUT"
    amount: number
    description: string
    createdAt: string
    user: { name: string }
    payment?: { method: PaymentMethod; amount: number } | null
}

interface Register {
    id: string
    initialAmount: number
    calculatedTotal: number
    expectedCash: number
    methodTotals: Record<PaymentMethod, number>
    openedAt: string
    openedById: string
    openedBy: { name: string }
    branch?: { id: string; name: string } | null
    movements: Movement[]
}

interface WeekRegister {
    id: string
    branch: { id: string; name: string } | null
    openedAt: string
    closedAt: string
    openedBy: { name: string }
    closedBy: { name: string } | null
    initialAmount: number
    finalAmount: number | null
    expectedCash: number
    difference: number | null
    notes: string | null
}

interface ClosureResult {
    registerId: string
    counted: number
    expected: number
    difference: number
}

interface CashRequestItem {
    id: string
    amountCents: number
    concept: string
    status: "PENDING" | "APPROVED" | "REJECTED"
    decisionNote: string | null
    createdAt: string
    branch: { id: string; name: string }
    requestedBy: { id: string; name: string }
    decidedBy: { id: string; name: string } | null
}

const requestStatusMeta: Record<CashRequestItem["status"], { label: string; variant: "warning" | "success" | "destructive" }> = {
    PENDING: { label: "Pendiente", variant: "warning" },
    APPROVED: { label: "Autorizado", variant: "success" },
    REJECTED: { label: "Rechazado", variant: "destructive" },
}

/** Gastos de caja con autorización: el staff solicita; solo un admin distinto decide. */
function CashRequestsPanel(props: { branchId: string; isAdmin: boolean; userId: string; onChanged: () => void }) {
    const [requests, setRequests] = useState<CashRequestItem[]>([])
    const [loadingRequests, setLoadingRequests] = useState(true)
    const [amount, setAmount] = useState("")
    const [concept, setConcept] = useState("")
    const [busy, setBusy] = useState(false)
    const createKey = useRef<ClientOperationKey | null>(null)
    const decideKeys = useRef<Record<string, ClientOperationKey | null>>({})

    const fetchRequests = async () => {
        try {
            const res = await fetch(`/api/cash-requests${props.branchId ? `?branchId=${props.branchId}` : ""}`)
            const data = await res.json()
            if (res.ok) setRequests(data.requests ?? [])
        } catch {
            // silencioso: el historial de caja sigue funcionando aunque falle esta lista
        }
    }

    useEffect(() => {
        let cancelled = false
        fetch(`/api/cash-requests${props.branchId ? `?branchId=${props.branchId}` : ""}`)
            .then(res => (res.ok ? res.json() : null))
            .then(data => { if (!cancelled && data) setRequests(data.requests ?? []) })
            .catch(() => {})
            .finally(() => { if (!cancelled) setLoadingRequests(false) })
        return () => { cancelled = true }
    }, [props.branchId])

    const pending = requests.filter(r => r.status === "PENDING")
    const history = requests.filter(r => r.status !== "PENDING").slice(0, 10)

    const submitRequest = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (busy) return
        const value = parseFloat(amount)
        if (!Number.isFinite(value) || value <= 0) return toast.error("Indica un monto mayor a cero")
        if (Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) return toast.error("El monto admite hasta dos decimales")
        if (concept.trim().length < 3) return toast.error("Describe el concepto (mínimo 3 caracteres)")
        if (!props.branchId) return toast.error("Selecciona la sucursal")
        setBusy(true)
        try {
            const payload = { branchId: props.branchId, amountCents: Math.round(value * 100), concept: concept.trim() }
            createKey.current = getClientOperationKey(createKey.current, payload)
            const res = await fetch("/api/cash-requests", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: createKey.current.key }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "No se pudo registrar la solicitud")
            createKey.current = null
            setAmount("")
            setConcept("")
            toast.success(data.duplicate ? "Ya tenías una solicitud igual registrada" : "Solicitud enviada. Pendiente de autorización.")
            await fetchRequests()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Error de conexión. Reintenta sin cambiar los datos.")
        } finally {
            setBusy(false)
        }
    }

    const decide = async (id: string, decision: "APPROVE" | "REJECT") => {
        if (busy) return
        let note: string | undefined
        if (decision === "REJECT") {
            const value = window.prompt("Motivo del rechazo (opcional):")
            if (value === null) return
            note = value.trim() || undefined
        }
        setBusy(true)
        try {
            const payload = { decision, note }
            decideKeys.current[id] = getClientOperationKey(decideKeys.current[id] ?? null, payload)
            const res = await fetch(`/api/cash-requests/${id}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: decideKeys.current[id]!.key }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "No se pudo decidir la solicitud")
            decideKeys.current[id] = null
            toast.success(decision === "APPROVE" ? "Gasto autorizado y asentado en caja" : "Solicitud rechazada")
            await fetchRequests()
            props.onChanged()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Error de conexión. Reintenta sin cambiar los datos.")
        } finally {
            setBusy(false)
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><ReceiptText className="h-5 w-5" /> Gastos y solicitudes</CardTitle>
                <CardDescription>Las salidas de efectivo por gastos requieren autorización del administrador.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
                <form onSubmit={e => void submitRequest(e)} className="grid gap-3 sm:grid-cols-[9rem_1fr_auto] sm:items-end">
                    <div className="space-y-2">
                        <Label>Monto</Label>
                        <Input type="number" min="0" step="0.01" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label>Concepto</Label>
                        <Input maxLength={200} placeholder="Ej. Pago de luz, mensajería…" value={concept} onChange={e => setConcept(e.target.value)} />
                    </div>
                    <Button type="submit" disabled={busy}>Solicitar gasto</Button>
                </form>

                {loadingRequests ? (
                    <p className="text-sm text-muted-foreground">Cargando solicitudes…</p>
                ) : (
                    <>
                        {pending.length > 0 && (
                            <div className="space-y-2">
                                <p className="text-sm font-medium">Pendientes de autorización</p>
                                {pending.map(req => (
                                    <div key={req.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                                        <div>
                                            <p className="font-medium">{formatPrice(req.amountCents / 100)} · {req.concept}</p>
                                            <p className="text-xs text-muted-foreground">{req.requestedBy.name} · {req.branch.name} · {formatDate(req.createdAt)}</p>
                                        </div>
                                        {props.isAdmin && req.requestedBy.id !== props.userId ? (
                                            <div className="flex gap-2">
                                                <Button size="sm" className="bg-green-600 hover:bg-green-700" disabled={busy} onClick={() => void decide(req.id, "APPROVE")}>
                                                    <Check className="w-4 h-4 mr-1" /> Autorizar
                                                </Button>
                                                <Button size="sm" variant="destructive" disabled={busy} onClick={() => void decide(req.id, "REJECT")}>
                                                    <X className="w-4 h-4 mr-1" /> Rechazar
                                                </Button>
                                            </div>
                                        ) : (
                                            <Badge variant="warning">{props.isAdmin ? "Tu solicitud · pendiente de otro admin" : "Pendiente de autorización"}</Badge>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                        {history.length > 0 && (
                            <div className="space-y-2">
                                <p className="text-sm font-medium">Historial reciente</p>
                                {history.map(req => (
                                    <div key={req.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0 text-sm">
                                        <div>
                                            <p className="font-medium">{formatPrice(req.amountCents / 100)} · {req.concept}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {req.requestedBy.name} · {req.branch.name} · {formatDate(req.createdAt)}
                                                {req.decidedBy ? ` · ${req.status === "APPROVED" ? "autorizado" : "rechazado"} por ${req.decidedBy.name}` : ""}
                                                {req.decisionNote ? ` — ${req.decisionNote}` : ""}
                                            </p>
                                        </div>
                                        <Badge variant={requestStatusMeta[req.status].variant}>{requestStatusMeta[req.status].label}</Badge>
                                    </div>
                                ))}
                            </div>
                        )}
                        {requests.length === 0 && <p className="text-sm text-muted-foreground">Sin solicitudes en esta sucursal.</p>}
                    </>
                )}
            </CardContent>
        </Card>
    )
}

/** Cortes cerrados de los últimos 7 días (GET /api/caja?view=week). */
function WeekPanel(props: { branchId: string; refreshKey: number }) {
    const [registers, setRegisters] = useState<WeekRegister[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false
        fetch(`/api/caja?view=week${props.branchId ? `&branchId=${props.branchId}` : ""}`)
            .then(res => (res.ok ? res.json() : null))
            .then(data => { if (!cancelled) setRegisters(data?.registers ?? []) })
            .catch(() => { if (!cancelled) toast.error("Error al cargar la semana") })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [props.branchId, props.refreshKey])

    if (loading) return <p className="text-sm text-muted-foreground text-center py-8">Cargando cortes…</p>
    if (registers.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">Sin cortes en los últimos 7 días.</p>

    return (
        <div className="space-y-3">
            {registers.map(reg => (
                <div key={reg.id} className="rounded-lg border p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <p className="font-medium flex items-center gap-2">
                                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                                {formatDay(reg.closedAt)} · {reg.branch?.name ?? "Sin sucursal"}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Abrió {reg.openedBy.name} · cerró {reg.closedBy?.name ?? "—"}
                            </p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => window.open(`/admin/tickets/corte/${reg.id}`, "_blank")}>
                            <ExternalLink className="w-4 h-4 mr-1" /> Ver corte
                        </Button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                        <div>
                            <p className="text-xs text-muted-foreground">Fondo inicial</p>
                            <p className="font-semibold">{formatPrice(reg.initialAmount)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">Contado</p>
                            <p className="font-semibold">{reg.finalAmount == null ? "—" : formatPrice(reg.finalAmount)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">Esperado</p>
                            <p className="font-semibold">{formatPrice(reg.expectedCash)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">Diferencia</p>
                            <p className={`font-semibold ${reg.difference == null ? "" : reg.difference > 0 ? "text-green-600" : reg.difference < 0 ? "text-destructive" : ""}`}>
                                {reg.difference == null ? "—" : reg.difference === 0 ? "Cuadrada" : `${reg.difference > 0 ? "+" : ""}${formatPrice(reg.difference)}`}
                            </p>
                        </div>
                    </div>
                    {reg.notes && <p className="text-xs text-muted-foreground border-t pt-2">Notas: {reg.notes}</p>}
                </div>
            ))}
        </div>
    )
}

export default function CajaPage() {
    // useSearchParams exige un boundary de Suspense (la página es 100% cliente).
    return (
        <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Cargando caja...</div>}>
            <CajaPanel />
        </Suspense>
    )
}

function CajaPanel() {
    const { data: session } = useSession()
    const isAdmin = session?.user?.role === "ADMIN"
    const userId = session?.user?.id ?? ""
    const [register, setRegister] = useState<Register | null>(null)
    const [loading, setLoading] = useState(true)
    const [submitting, setSubmitting] = useState(false)
    const inFlight = useRef(false)
    const operationKeys = useRef<Record<string, ClientOperationKey | null>>({})
    const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
    const [branchId, setBranchId] = useState("")
    const [lastClosure, setLastClosure] = useState<ClosureResult | null>(null)
    const [weekRefresh, setWeekRefresh] = useState(0)

    // Pestaña activa desde la URL (?tab=caja|solicitudes|proveedores).
    const searchParams = useSearchParams()
    const pathname = usePathname()
    const router = useRouter()
    const rawTab = searchParams.get("tab")
    const tab: CajaTab = (CAJA_TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as CajaTab) : "caja"
    const handleTabChange = (value: string) => {
        router.replace(`${pathname}?tab=${value}`, { scroll: false })
    }

    const postCash = async (payload: Record<string, unknown>) => {
        const action = String(payload.action)
        const operation = getClientOperationKey(operationKeys.current[action] ?? null, { registerId: register?.id, ...payload })
        operationKeys.current[action] = operation
        const response = await fetch('/api/caja', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ registerId: register?.id, branchId: branchId || undefined, ...payload, idempotencyKey: operation.key }),
        })
        if (response.ok) operationKeys.current[action] = null
        return response
    }

    // Modales / inputs
    const [openAmount, setOpenAmount] = useState("")
    const [movAmount, setMovAmount] = useState("")
    const [movType, setMovType] = useState<"IN" | "OUT">("IN")
    const [movDesc, setMovDesc] = useState("")

    // Cierre: conteo por denominaciones (o captura directa del total).
    const [closeOpen, setCloseOpen] = useState(false)
    const [denomCounts, setDenomCounts] = useState<Record<string, string>>({})
    const [manualClose, setManualClose] = useState(false)
    const [manualAmount, setManualAmount] = useState("")
    const [closeNotes, setCloseNotes] = useState("")

    const fetchRegister = useCallback(async () => {
        try {
            const res = await fetch(`/api/caja${branchId ? `?branchId=${branchId}` : ""}`)
            const data = await res.json()
            if (data.active) {
                setRegister(data.register)
            } else {
                setRegister(null)
            }
        } catch {
            toast.error("Error al cargar la caja")
        } finally {
            setLoading(false)
        }
    }, [branchId])

    useEffect(() => {
        fetch("/api/branches").then(r => r.ok ? r.json() : null).then(d => {
            const list = (d?.branches ?? []).filter((b: { isActive: boolean }) => b.isActive)
            setBranches(list)
            if (list.length) setBranchId(prev => prev || list[0].id)
        }).catch(() => {})
    }, [])

    useEffect(() => {
        const timer = setTimeout(() => { if (branchId || branches.length === 0) void fetchRegister() }, 0)
        return () => clearTimeout(timer)
    }, [branchId, branches.length, fetchRegister])

    const handleOpen = async () => {
        if (inFlight.current) return
        inFlight.current = true; setSubmitting(true)
        try {
            const res = await postCash({ action: "OPEN", amount: parseFloat(openAmount) || 0 })
            if (res.ok) {
                toast.success("Caja abierta correctamente")
                setLastClosure(null)
                fetchRegister()
            } else {
                const data = await res.json().catch(() => null)
                toast.error(data?.error || "Error al abrir la caja")
            }
        } catch {
            toast.error("Error de conexión. Puedes reintentar sin duplicar la operación.")
        } finally {
            inFlight.current = false; setSubmitting(false)
        }
    }

    const countedCents = DENOMINATIONS.reduce((sum, d) => sum + d.cents * (parseInt(denomCounts[d.key] || "0", 10) || 0), 0)
    const expectedCents = register ? Math.round(register.expectedCash * 100) : 0
    const liveDifferenceCents = countedCents - expectedCents
    const manualCents = Math.round((parseFloat(manualAmount) || 0) * 100)
    const manualDifferenceCents = manualCents - expectedCents

    const handleClose = async () => {
        if (inFlight.current || !register) return
        // Sin conteo, el cierre clásico solo manda el monto capturado.
        const payload: Record<string, unknown> = manualClose
            ? { action: "CLOSE", amount: manualCents / 100, description: closeNotes || undefined }
            : {
                action: "CLOSE",
                amount: countedCents / 100,
                description: closeNotes || undefined,
                denominations: Object.fromEntries(
                    DENOMINATIONS.map(d => [d.key, parseInt(denomCounts[d.key] || "0", 10) || 0])
                ),
            }
        inFlight.current = true; setSubmitting(true)
        try {
            const res = await postCash(payload)
            const data = await res.json().catch(() => null)
            if (res.ok) {
                const difference = (data?.differenceCents ?? 0) / 100
                toast.success(
                    difference === 0 ? "Caja cerrada: turno cuadrado"
                        : difference > 0 ? `Caja cerrada con sobrante de ${formatPrice(difference)}`
                            : `Caja cerrada con faltante de ${formatPrice(Math.abs(difference))}`
                )
                setLastClosure({
                    registerId: data?.register?.id ?? register.id,
                    counted: data?.register?.finalAmount ?? (manualClose ? manualCents : countedCents) / 100,
                    expected: (data?.expectedCashCents ?? expectedCents) / 100,
                    difference,
                })
                setCloseOpen(false)
                setDenomCounts({})
                setManualAmount("")
                setCloseNotes("")
                setWeekRefresh(k => k + 1)
                fetchRegister()
            } else {
                toast.error(data?.error || "Error al cerrar la caja")
            }
        } catch {
            toast.error("Error de conexión. Puedes reintentar sin duplicar la operación.")
        } finally {
            inFlight.current = false; setSubmitting(false)
        }
    }

    const handleMovement = async () => {
        if (inFlight.current) return
        if (!movAmount || !movDesc) return toast.error("Llena todos los campos")
        inFlight.current = true; setSubmitting(true)
        try {
            const res = await postCash({ action: "MOVEMENT", type: movType, amount: parseFloat(movAmount), description: movDesc })
            const data = await res.json().catch(() => null)
            if (res.ok) {
                toast.success("Movimiento registrado")
                setMovAmount("")
                setMovDesc("")
                fetchRegister()
            } else {
                toast.error(data?.error || "Error al registrar movimiento")
            }
        } catch {
            toast.error("Error de conexión. Puedes reintentar sin duplicar la operación.")
        } finally {
            inFlight.current = false; setSubmitting(false)
        }
    }

    const differenceBadge = (diffCents: number) => {
        if (diffCents === 0) return <Badge variant="success">Cuadrado</Badge>
        if (diffCents > 0) return <Badge variant="success">Sobrante +{formatPrice(diffCents / 100)}</Badge>
        return <Badge variant="destructive">Faltante {formatPrice(diffCents / 100)}</Badge>
    }

    const branchSelector = branches.length > 1 ? (
        <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="w-full">
                <SelectValue placeholder="Sucursal" />
            </SelectTrigger>
            <SelectContent>
                {branches.map(b => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    ) : null

    const openCard = (
        <div className="max-w-2xl mx-auto mt-6 space-y-6">
            {lastClosure && (
                <Card className="max-w-md mx-auto border-primary/30">
                    <CardHeader className="text-center pb-3">
                        <CardTitle className="text-base">Corte realizado</CardTitle>
                        <CardDescription>Resumen del cierre de turno</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                        <div className="grid grid-cols-3 gap-2 text-center">
                            <div>
                                <p className="text-xs text-muted-foreground">Contado</p>
                                <p className="font-semibold">{formatPrice(lastClosure.counted)}</p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Esperado</p>
                                <p className="font-semibold">{formatPrice(lastClosure.expected)}</p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Diferencia</p>
                                <p className={`font-semibold ${lastClosure.difference > 0 ? "text-green-600" : lastClosure.difference < 0 ? "text-destructive" : ""}`}>
                                    {lastClosure.difference === 0 ? "Cuadrada" : `${lastClosure.difference > 0 ? "+" : ""}${formatPrice(lastClosure.difference)}`}
                                </p>
                            </div>
                        </div>
                        <Button variant="outline" className="w-full" onClick={() => window.open(`/admin/tickets/corte/${lastClosure.registerId}`, "_blank")}>
                            <Printer className="w-4 h-4 mr-2" /> Imprimir corte
                        </Button>
                    </CardContent>
                </Card>
            )}
            <Card className="max-w-md mx-auto">
                <CardHeader className="text-center">
                    <div className="mx-auto bg-primary/10 p-3 rounded-full mb-2 w-fit">
                        <Lock className="w-8 h-8 text-primary" />
                    </div>
                    <CardTitle>Caja Cerrada</CardTitle>
                    <CardDescription>Abre la caja para comenzar a operar hoy.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {branchSelector}
                    <div className="space-y-2">
                        <Label>Efectivo inicial en caja</Label>
                        <Input
                            type="number"
                            min="0"
                            placeholder="Ej. 500"
                            value={openAmount}
                            onChange={(e) => setOpenAmount(e.target.value)}
                        />
                    </div>
                    <Button className="w-full" onClick={handleOpen} disabled={submitting}>
                        Abrir Turno
                    </Button>
                </CardContent>
            </Card>
            {/* Los gastos pueden solicitarse aunque la caja esté cerrada (pestaña «Solicitudes»); autorizarlos requiere caja abierta. */}
        </div>
    )

    const shiftView = !register ? openCard : (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <Wallet className="h-6 w-6" /> Control de Caja
                    </h1>
                    <p className="text-muted-foreground">
                        Abierta por {register.openedBy.name} el {formatDate(register.openedAt)}
                    </p>
                </div>
                {branchSelector && <div className="w-full sm:w-44">{branchSelector}</div>}
            </div>

            <div className="grid md:grid-cols-3 gap-4">
                <Card className="bg-primary text-primary-foreground">
                    <CardContent className="p-6">
                        <p className="text-primary-foreground/80 text-sm font-medium">Efectivo Esperado</p>
                        <h2 className="text-3xl font-bold mt-2">{formatPrice(register.expectedCash)}</h2>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6">
                        <p className="text-muted-foreground text-sm font-medium">Fondo Inicial</p>
                        <h2 className="text-2xl font-bold mt-2">{formatPrice(register.initialAmount)}</h2>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6">
                        <p className="text-muted-foreground text-sm font-medium">Movimientos</p>
                        <h2 className="text-2xl font-bold mt-2">{register.movements.length}</h2>
                    </CardContent>
                </Card>
            </div>

            {/* Cobros del turno por método: tarjeta/transferencia no pasan por
                la caja pero sí forman parte del corte del día. */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Cobrado en el turno por método</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                        {(["CASH", "CARD", "TRANSFER", "CREDIT"] as const).map(method => (
                            <div key={method} className="rounded-lg border p-3">
                                <p className="text-xs text-muted-foreground">{METHOD_LABELS[method]}</p>
                                <p className="font-bold text-lg">{formatPrice(register.methodTotals?.[method] ?? 0)}</p>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            <div className="grid lg:grid-cols-2 gap-8">
                {/* Registrar Movimiento */}
                <Card>
                    <CardHeader>
                        <CardTitle>Nuevo Movimiento</CardTitle>
                        <CardDescription>Retiros de dinero, pagos a proveedores o ingresos extra.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-2">
                            <Button
                                variant={movType === "IN" ? "default" : "outline"}
                                onClick={() => setMovType("IN")}
                                className={movType === "IN" ? "bg-green-600 hover:bg-green-700" : ""}
                            >
                                <ArrowDownCircle className="w-4 h-4 mr-2" /> Ingreso
                            </Button>
                            {/* La salida directa de efectivo es solo de admin; el empleado
                                solicita el gasto y otro admin lo autoriza (pestaña «Solicitudes»). */}
                            <Button
                                variant={movType === "OUT" ? "destructive" : "outline"}
                                onClick={() => { if (isAdmin) setMovType("OUT") }}
                                disabled={!isAdmin}
                                title={isAdmin ? undefined : "Requiere aprobación — usa Solicitar gasto"}
                            >
                                <ArrowUpCircle className="w-4 h-4 mr-2" /> Retiro / Gasto
                            </Button>
                        </div>
                        {!isAdmin && (
                            <p className="text-xs text-muted-foreground -mt-1">
                                Los retiros de efectivo requieren autorización de un administrador — usa la pestaña «Solicitudes».
                            </p>
                        )}
                        <div className="space-y-2">
                            <Label>Monto</Label>
                            <Input type="number" placeholder="0.00" value={movAmount} onChange={e => setMovAmount(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Concepto</Label>
                            <Input placeholder="Ej. Pago de luz, Compra refacciones..." value={movDesc} onChange={e => setMovDesc(e.target.value)} />
                        </div>
                        <Button className="w-full" onClick={handleMovement} disabled={submitting}>Registrar</Button>
                    </CardContent>
                </Card>

                {/* Cierre de Caja */}
                <Card className="border-destructive/20">
                    <CardHeader>
                        <CardTitle className="text-destructive flex items-center gap-2">
                            <Unlock className="h-5 w-5" /> Cierre de Turno
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="bg-muted p-3 rounded-md text-sm mb-4">
                            <p className="font-medium">Efectivo esperado en caja: {formatPrice(register.expectedCash)}</p>
                            <p className="text-muted-foreground mt-1">Al cerrar contarás los billetes y monedas físicas para cuadrar el turno.</p>
                        </div>
                        <Button
                            variant="destructive"
                            className="w-full"
                            onClick={() => setCloseOpen(true)}
                            disabled={submitting || (!isAdmin && register.openedById !== userId)}
                            title={!isAdmin && register.openedById !== userId ? "Solo un administrador o quien abrió el turno puede cerrarlo" : undefined}
                        >
                            <Coins className="w-4 h-4 mr-2" /> Contar y cerrar caja
                        </Button>
                    </CardContent>
                </Card>
            </div>

            {/* Historial */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><History className="h-5 w-5" /> Historial del Turno</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-3">
                        {register.movements.map(mov => (
                            <div key={mov.id} className="flex items-center justify-between p-3 border-b last:border-0 text-sm">
                                <div>
                                    <p className="font-medium flex items-center gap-2 flex-wrap">
                                        {mov.description}
                                        {mov.payment && (
                                            <Badge variant="outline" className="text-[10px] font-normal">
                                                {METHOD_LABELS[mov.payment.method] ?? mov.payment.method}
                                            </Badge>
                                        )}
                                    </p>
                                    <p className="text-xs text-muted-foreground">{formatDate(mov.createdAt)} • {mov.user.name}</p>
                                </div>
                                <div className={`font-bold ${mov.type === 'IN' ? 'text-green-600' : 'text-destructive'}`}>
                                    {mov.type === 'IN' ? '+' : '-'}{formatPrice(mov.amount)}
                                </div>
                            </div>
                        ))}
                        {register.movements.length === 0 && <p className="text-muted-foreground text-center py-4">No hay movimientos aún</p>}
                    </div>
                </CardContent>
            </Card>

        </div>
    )

    return (
        <Tabs value={tab} onValueChange={handleTabChange} className="space-y-6">
            <div className="overflow-x-auto pb-2">
                <TabsList className="flex-nowrap min-w-max">
                    <TabsTrigger value="caja" className="flex items-center gap-2">
                        <Wallet className="h-4 w-4" /> Caja
                    </TabsTrigger>
                    <TabsTrigger value="solicitudes" className="flex items-center gap-2">
                        <ReceiptText className="h-4 w-4" /> Solicitudes
                    </TabsTrigger>
                    <TabsTrigger value="proveedores" className="flex items-center gap-2">
                        <Truck className="h-4 w-4" /> Les debo
                    </TabsTrigger>
                </TabsList>
            </div>

            <TabsContent value="caja">
                {loading ? (
                    <div className="p-8 text-center text-muted-foreground">Cargando caja...</div>
                ) : (
                    <Tabs defaultValue="turno" className="space-y-6">
                        <TabsList>
                            <TabsTrigger value="turno">Turno actual</TabsTrigger>
                            <TabsTrigger value="semana">Semana</TabsTrigger>
                        </TabsList>
                        <TabsContent value="turno">{shiftView}</TabsContent>
                        <TabsContent value="semana">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" /> Cortes de los últimos 7 días</CardTitle>
                                    <CardDescription>Cada cierre con su efectivo contado, esperado y diferencia.</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    {branchSelector && <div className="w-full sm:w-56">{branchSelector}</div>}
                                    <WeekPanel branchId={branchId} refreshKey={weekRefresh} />
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>
                )}
            </TabsContent>

            <TabsContent value="solicitudes" className="space-y-4">
                {branchSelector && <div className="w-full sm:w-56">{branchSelector}</div>}
                <CashRequestsPanel branchId={branchId} isAdmin={isAdmin} userId={userId} onChanged={fetchRegister} />
            </TabsContent>

            <TabsContent value="proveedores">
                <LesDeboPanel />
            </TabsContent>

            {/* Diálogo de cierre con conteo de billetes */}
            <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
                <DialogContent className="space-y-4">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2"><Banknote className="h-5 w-5" /> Corte de caja</DialogTitle>
                        <DialogDescription>
                            Cuenta el efectivo físico por denominación. El total contado se compara contra el esperado de {formatPrice(register?.expectedCash ?? 0)}.
                        </DialogDescription>
                    </DialogHeader>

                    {!manualClose ? (
                        <>
                            <div className="space-y-2">
                                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Billetes</p>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                    {DENOMINATIONS.filter(d => d.kind === "bill").map(d => {
                                        const qty = parseInt(denomCounts[d.key] || "0", 10) || 0
                                        return (
                                            <div key={d.key} className="flex items-center gap-2">
                                                <span className="w-14 text-sm font-medium">{d.label}</span>
                                                <span className="text-xs text-muted-foreground">×</span>
                                                <Input
                                                    type="number" min="0" step="1" inputMode="numeric"
                                                    className="h-8 w-20"
                                                    value={denomCounts[d.key] ?? ""}
                                                    onChange={e => setDenomCounts(prev => ({ ...prev, [d.key]: e.target.value }))}
                                                />
                                                <span className="text-xs text-muted-foreground ml-auto w-20 text-right">{formatPrice(d.cents * qty / 100)}</span>
                                            </div>
                                        )
                                    })}
                                </div>
                                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide pt-2">Monedas</p>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                    {DENOMINATIONS.filter(d => d.kind === "coin").map(d => {
                                        const qty = parseInt(denomCounts[d.key] || "0", 10) || 0
                                        return (
                                            <div key={d.key} className="flex items-center gap-2">
                                                <span className="w-14 text-sm font-medium">{d.label}</span>
                                                <span className="text-xs text-muted-foreground">×</span>
                                                <Input
                                                    type="number" min="0" step="1" inputMode="numeric"
                                                    className="h-8 w-20"
                                                    value={denomCounts[d.key] ?? ""}
                                                    onChange={e => setDenomCounts(prev => ({ ...prev, [d.key]: e.target.value }))}
                                                />
                                                <span className="text-xs text-muted-foreground ml-auto w-20 text-right">{formatPrice(d.cents * qty / 100)}</span>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>

                            <div className="rounded-lg border p-3 space-y-1.5 text-sm">
                                <div className="flex justify-between"><span className="text-muted-foreground">Total contado</span><span className="font-bold">{formatPrice(countedCents / 100)}</span></div>
                                <div className="flex justify-between"><span className="text-muted-foreground">Esperado en sistema</span><span className="font-medium">{formatPrice(expectedCents / 100)}</span></div>
                                <div className="flex justify-between items-center border-t pt-1.5">
                                    <span className="text-muted-foreground">Diferencia</span>
                                    {differenceBadge(liveDifferenceCents)}
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="space-y-2">
                                <Label>Efectivo real contado</Label>
                                <Input type="number" min="0" step="0.01" value={manualAmount} onChange={e => setManualAmount(e.target.value)} />
                            </div>
                            <div className="rounded-lg border p-3 space-y-1.5 text-sm">
                                <div className="flex justify-between"><span className="text-muted-foreground">Esperado en sistema</span><span className="font-medium">{formatPrice(expectedCents / 100)}</span></div>
                                <div className="flex justify-between items-center border-t pt-1.5">
                                    <span className="text-muted-foreground">Diferencia</span>
                                    {differenceBadge(manualDifferenceCents)}
                                </div>
                            </div>
                        </>
                    )}

                    <div className="space-y-2">
                        <Label>Notas (opcional)</Label>
                        <Input placeholder="Justificación de faltantes/sobrantes" value={closeNotes} onChange={e => setCloseNotes(e.target.value)} />
                    </div>

                    <button
                        type="button"
                        className="text-xs text-muted-foreground underline underline-offset-2"
                        onClick={() => setManualClose(v => !v)}
                    >
                        {manualClose ? "Contar por denominaciones" : "Capturar el total sin conteo"}
                    </button>

                    <Button
                        variant="destructive"
                        className="w-full"
                        onClick={handleClose}
                        disabled={submitting || (manualClose && !(parseFloat(manualAmount) >= 0 && manualAmount !== ""))}
                    >
                        Confirmar cierre de caja
                    </Button>
                </DialogContent>
            </Dialog>
        </Tabs>
    )
}
