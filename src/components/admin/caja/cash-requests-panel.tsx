"use client"

import { useState, useEffect, useRef } from "react"
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
    const [amount, setAmount] = useState("")
    const [concept, setConcept] = useState("")
    const [busy, setBusy] = useState(false)
    const [rejectTarget, setRejectTarget] = useState<CashRequestItem | null>(null)
    const [rejectNote, setRejectNote] = useState("")
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
            if (decision === "REJECT") {
                setRejectTarget(null)
                setRejectNote("")
            }
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
                                                <Button size="sm" className="bg-green-600 hover:bg-green-700" disabled={busy} onClick={() => void decide(req.id, "APPROVE")}>
                                                    <Check className="w-4 h-4 mr-1" /> Autorizar
                                                </Button>
                                                <Button size="sm" variant="destructive" disabled={busy} onClick={() => { setRejectTarget(req); setRejectNote("") }}>
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
                    open={Boolean(rejectTarget)}
                    onOpenChange={open => {
                        if (!busy && !open) {
                            setRejectTarget(null)
                            setRejectNote("")
                        }
                    }}
                >
                    <DialogContent className="space-y-4 sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>Rechazar solicitud de gasto</DialogTitle>
                            <DialogDescription>
                                {rejectTarget
                                    ? `${formatPrice(rejectTarget.amountCents / 100)} · ${rejectTarget.concept} (${rejectTarget.requestedBy.name})`
                                    : "Indica el motivo del rechazo (opcional)."}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-2">
                            <Label htmlFor="reject-cash-request-note">Motivo del rechazo (opcional)</Label>
                            <Input
                                id="reject-cash-request-note"
                                maxLength={200}
                                placeholder="Ej. Gasto no autorizado o comprobante pendiente…"
                                value={rejectNote}
                                onChange={e => setRejectNote(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <DialogFooter className="gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                disabled={busy}
                                onClick={() => {
                                    setRejectTarget(null)
                                    setRejectNote("")
                                }}
                            >
                                Cancelar
                            </Button>
                            <Button
                                type="button"
                                variant="destructive"
                                disabled={busy || !rejectTarget}
                                onClick={() => {
                                    if (rejectTarget) void decide(rejectTarget.id, "REJECT", rejectNote.trim() || undefined)
                                }}
                            >
                                Confirmar rechazo
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    )
}
