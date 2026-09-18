"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useSession } from "next-auth/react"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"
import { formatPrice, formatDate } from "@/lib/utils"
import { 
    Wallet, 
    ArrowUpCircle, 
    ArrowDownCircle, 
    Lock, 
    Unlock,
    History,
    ReceiptText,
    Check,
    X
} from "lucide-react"

interface Movement {
    id: string
    type: "IN" | "OUT"
    amount: number
    description: string
    createdAt: string
    user: { name: string }
}

interface Register {
    id: string
    initialAmount: number
    calculatedTotal: number
    openedAt: string
    openedById: string
    openedBy: { name: string }
    movements: Movement[]
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

export default function CajaPage() {
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
    
    const [closeAmount, setCloseAmount] = useState("")
    const [closeNotes, setCloseNotes] = useState("")

    const fetchRegister = useCallback(async () => {
        try {
            const res = await fetch(`/api/caja${branchId ? `?branchId=${branchId}` : ""}`)
            const data = await res.json()
            if (data.active) {
                setRegister(data.register)
                setCloseAmount(data.register.calculatedTotal.toString())
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
                fetchRegister()
            } else {
                toast.error("Error al abrir la caja")
            }
        } catch {
            toast.error("Error de conexión. Puedes reintentar sin duplicar la operación.")
        } finally {
            inFlight.current = false; setSubmitting(false)
        }
    }

    const handleClose = async () => {
        if (inFlight.current) return
        if (!confirm("¿Seguro que deseas cerrar la caja?")) return
        inFlight.current = true; setSubmitting(true)
        try {
            const res = await postCash({ action: "CLOSE", amount: parseFloat(closeAmount) || 0, description: closeNotes })
            if (res.ok) {
                toast.success("Caja cerrada correctamente")
                fetchRegister()
            } else {
                toast.error("Error al cerrar la caja")
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
            if (res.ok) {
                toast.success("Movimiento registrado")
                setMovAmount("")
                setMovDesc("")
                fetchRegister()
            } else {
                toast.error("Error al registrar movimiento")
            }
        } catch {
            toast.error("Error de conexión. Puedes reintentar sin duplicar la operación.")
        } finally {
            inFlight.current = false; setSubmitting(false)
        }
    }

    if (loading) return <div className="p-8 text-center text-muted-foreground">Cargando caja...</div>

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

    if (!register) {
        return (
            <div className="max-w-2xl mx-auto mt-12 space-y-6">
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
                {/* Los gastos pueden solicitarse aunque la caja esté cerrada; autorizarlos requiere caja abierta. */}
                <CashRequestsPanel branchId={branchId} isAdmin={isAdmin} userId={userId} onChanged={fetchRegister} />
            </div>
        )
    }

    return (
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
                        <p className="text-primary-foreground/80 text-sm font-medium">Efectivo Total Esperado</p>
                        <h2 className="text-3xl font-bold mt-2">{formatPrice(register.calculatedTotal)}</h2>
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
                                solicita el gasto y otro admin lo autoriza (panel de abajo). */}
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
                                Los retiros de efectivo requieren autorización de un administrador — usa «Solicitar gasto» más abajo.
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
                            <p className="font-medium">Total en sistema: {formatPrice(register.calculatedTotal)}</p>
                            <p className="text-muted-foreground mt-1">Cuenta el efectivo físico en caja y anótalo abajo para validar diferencias.</p>
                        </div>
                        <div className="space-y-2">
                            <Label>Efectivo Real Contado</Label>
                            <Input type="number" value={closeAmount} onChange={e => setCloseAmount(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Notas (Opcional)</Label>
                            <Input placeholder="Justificación de faltantes/sobrantes" value={closeNotes} onChange={e => setCloseNotes(e.target.value)} />
                        </div>
                        <Button
                            variant="destructive"
                            className="w-full mt-4"
                            onClick={handleClose}
                            disabled={submitting || (!isAdmin && register.openedById !== userId)}
                            title={!isAdmin && register.openedById !== userId ? "Solo un administrador o quien abrió el turno puede cerrarlo" : undefined}
                        >
                            Confirmar Cierre de Caja
                        </Button>
                    </CardContent>
                </Card>
            </div>

            {/* Gastos con autorización */}
            <CashRequestsPanel branchId={branchId} isAdmin={isAdmin} userId={userId} onChanged={fetchRegister} />

            {/* Historial */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><History className="h-5 w-5"/> Historial del Turno</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-3">
                        {register.movements.map(mov => (
                            <div key={mov.id} className="flex items-center justify-between p-3 border-b last:border-0 text-sm">
                                <div>
                                    <p className="font-medium">{mov.description}</p>
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
}