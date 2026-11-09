"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { toast } from "sonner"
import { formatPrice, formatDate } from "@/lib/utils"
import { ReceiptText, Check, X } from "lucide-react"

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
export function CashRequestsPanel(props: { branchId: string; isAdmin: boolean; userId: string; onChanged: () => void }) {
    const [requests, setRequests] = useState<CashRequestItem[]>([])
    const [loadingRequests, setLoadingRequests] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [amount, setAmount] = useState("")
    const [concept, setConcept] = useState("")
    const [busy, setBusy] = useState(false)
    // Una autorización asienta salida de efectivo real e irreversible: igual
    // que el rechazo, pasa por confirmación con el detalle de la solicitud.
    const [decisionTarget, setDecisionTarget] = useState<{ req: CashRequestItem; decision: "APPROVE" | "REJECT" } | null>(null)
    const [decisionNote, setDecisionNote] = useState("")
    const createKey = useRef<ClientOperationKey | null>(null)
    const decideKeys = useRef<Record<string, ClientOperationKey | null>>({})
    const requestVersion = useRef(0)

    const fetchRequests = useCallback(async () => {
        const version = ++requestVersion.current
        setLoadError(null)
        try {
            const res = await fetch(`/api/cash-requests${props.branchId ? `?branchId=${props.branchId}` : ""}`)
            const data = await res.json().catch(() => null)
            if (version !== requestVersion.current) return
            if (!res.ok) throw new Error(data?.error || "No se pudieron cargar las solicitudes.")
            setRequests(data?.requests ?? [])
        } catch (e) {
            if (version !== requestVersion.current) return
            // La cola de autorización maneja dinero: la lista vacía por error
            // NO puede hacerse pasar por "sin solicitudes" — se muestra el fallo.
            setRequests([])
            setLoadError(e instanceof Error ? e.message : "Error al cargar las solicitudes.")
        } finally {
            if (version === requestVersion.current) setLoadingRequests(false)
        }
    }, [props.branchId])

    useEffect(() => {
        // Diferido (patrón del centro de dinero): el spinner y la carga no
        // disparan setState sincrónico dentro del efecto.
        void Promise.resolve().then(() => {
            setLoadingRequests(true)
            void fetchRequests()
        })
    }, [fetchRequests])

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
            if (data.duplicate) {
                toast.info("Ya habías enviado una solicitud idéntica hace unos segundos")
            } else {
                toast.success("Solicitud enviada. Pendiente de autorización.")
            }
            await fetchRequests()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Error de conexión. Reintenta sin cambiar los datos.")
        } finally {
            setBusy(false)
        }
    }

    const decide = async (id: string, decision: "APPROVE" | "REJECT", note?: string) => {
        if (busy) return
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
            setDecisionTarget(null)
            setDecisionNote("")
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
                        <Label htmlFor="cash-request-amount">Monto</Label>
                        <Input id="cash-request-amount" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="cash-request-concept">Concepto</Label>
                        <Input id="cash-request-concept" maxLength={200} placeholder="Ej. Pago de luz, mensajería…" value={concept} onChange={e => setConcept(e.target.value)} />
                    </div>
                    <Button type="submit" disabled={busy}>Solicitar gasto</Button>
                </form>

                {loadingRequests ? (
                    <p className="text-sm text-muted-foreground">Cargando solicitudes…</p>
                ) : loadError ? (
                    <div role="alert" className="rounded-lg border p-6 space-y-3 text-sm">
                        <p>{loadError}</p>
                        <Button variant="outline" size="sm" onClick={() => void fetchRequests()}>Reintentar</Button>
                    </div>
                ) : (
                    <>
                        {pending.length > 0 && (
                            <div className="space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
                                    <span className="font-medium text-amber-900 dark:text-amber-200">
                                        {pending.length === 1
                                            ? "1 solicitud esperando autorización"
                                            : `${pending.length} solicitudes esperando autorización`}
                                    </span>
                                    <span className="font-semibold tabular-nums text-amber-950 dark:text-amber-100">
                                        Total: {formatPrice(pending.reduce((sum, r) => sum + r.amountCents, 0) / 100)}
                                    </span>
                                </div>
                                <p className="text-sm font-medium">Pendientes de autorización</p>
                                {pending.map(req => (
                                    <div key={req.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                                        <div>
                                            <p className="font-medium">{formatPrice(req.amountCents / 100)} · {req.concept}</p>
                                            <p className="text-xs text-muted-foreground">{req.requestedBy.name} · {req.branch.name} · {formatDate(req.createdAt)}</p>
                                        </div>
                                        {props.isAdmin && req.requestedBy.id !== props.userId ? (
                                            <div className="flex gap-2">
                                                <Button size="sm" className="bg-green-600 hover:bg-green-700" disabled={busy} onClick={() => { setDecisionTarget({ req, decision: "APPROVE" }); setDecisionNote("") }}>
                                                    <Check className="w-4 h-4 mr-1" /> Autorizar
                                                </Button>
                                                <Button size="sm" variant="destructive" disabled={busy} onClick={() => { setDecisionTarget({ req, decision: "REJECT" }); setDecisionNote("") }}>
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

                <Dialog
                    open={Boolean(decisionTarget)}
                    onOpenChange={open => {
                        if (!busy && !open) {
                            setDecisionTarget(null)
                            setDecisionNote("")
                        }
                    }}
                >
                    <DialogContent className="space-y-4 sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>
                                {decisionTarget?.decision === "APPROVE" ? "Autorizar gasto" : "Rechazar solicitud de gasto"}
                            </DialogTitle>
                            <DialogDescription>
                                {decisionTarget
                                    ? `${formatPrice(decisionTarget.req.amountCents / 100)} · ${decisionTarget.req.concept} (${decisionTarget.req.requestedBy.name})`
                                    : "Confirma la decisión sobre la solicitud."}
                            </DialogDescription>
                        </DialogHeader>
                        {decisionTarget?.decision === "APPROVE" && (
                            <p className="text-sm rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-900 dark:text-amber-200">
                                Se registrará una salida de efectivo de {formatPrice(decisionTarget.req.amountCents / 100)} en la caja abierta de {decisionTarget.req.branch.name}. Esta operación no se puede deshacer.
                            </p>
                        )}
                        <div className="space-y-2">
                            <Label htmlFor="cash-request-decision-note">
                                {decisionTarget?.decision === "APPROVE" ? "Nota (opcional)" : "Motivo del rechazo (opcional)"}
                            </Label>
                            <Input
                                id="cash-request-decision-note"
                                maxLength={200}
                                placeholder={decisionTarget?.decision === "APPROVE" ? "Ej. Autorizado por gerencia…" : "Ej. Gasto no autorizado o comprobante pendiente…"}
                                value={decisionNote}
                                onChange={e => setDecisionNote(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <DialogFooter className="gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                disabled={busy}
                                onClick={() => {
                                    setDecisionTarget(null)
                                    setDecisionNote("")
                                }}
                            >
                                Cancelar
                            </Button>
                            <Button
                                type="button"
                                variant={decisionTarget?.decision === "APPROVE" ? "default" : "destructive"}
                                disabled={busy || !decisionTarget}
                                onClick={() => {
                                    if (decisionTarget) void decide(decisionTarget.req.id, decisionTarget.decision, decisionNote.trim() || undefined)
                                }}
                            >
                                {decisionTarget?.decision === "APPROVE" ? "Autorizar y descontar de caja" : "Confirmar rechazo"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    )
}
