"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { History, Loader2, RefreshCw, Trash2, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { formatDate, formatPrice } from "@/lib/utils"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { docAgeLabel, type PosDocumentSummary } from "./types"

interface ParkedSalesSheetProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    branchId: string
    /** La página carga el detalle y lo vuelca al ticket; true cierra el drawer. */
    onResume: (docId: string) => Promise<boolean>
    /** Sube tras suspender/descartar para forzar recarga en la próxima apertura. */
    refreshKey: number
}

/** Ventas suspendidas (documentos DRAFT/RETAIL) de la sucursal activa. */
export function ParkedSalesSheet({ open, onOpenChange, branchId, onResume, refreshKey }: ParkedSalesSheetProps) {
    const [documents, setDocuments] = useState<PosDocumentSummary[]>([])
    const [loading, setLoading] = useState(false)
    // "Ahora" se fotografía al cargar: Date.now() en render viola react-hooks/purity.
    const [nowMs, setNowMs] = useState<number | null>(null)
    const [resumingId, setResumingId] = useState<string | null>(null)
    const [discardTarget, setDiscardTarget] = useState<PosDocumentSummary | null>(null)
    const [discarding, setDiscarding] = useState(false)
    const discardKey = useRef(0)
    // La cancelación exige idempotencyKey: mismo documento reutiliza la llave.
    const pendingCancel = useRef<ClientOperationKey | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            // Sin filtro de kind: RETAIL y WORKSHOP son ventas suspendidas
            // (QUOTE también es DRAFT, pero se gestiona desde cotizaciones).
            const params = new URLSearchParams({ status: "DRAFT" })
            if (branchId) params.set("branchId", branchId)
            const res = await fetch(`/api/pos/documents?${params}`)
            const data: { documents?: PosDocumentSummary[]; error?: string } | null = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudieron cargar")
            setDocuments((data?.documents ?? []).filter(d => d.kind === "RETAIL" || d.kind === "WORKSHOP"))
            setNowMs(Date.now())
        } catch (error) {
            setDocuments([])
            toast.error(error instanceof Error ? error.message : "No se pudieron cargar las ventas suspendidas")
        } finally {
            setLoading(false)
        }
    }, [branchId])

    useEffect(() => {
        if (!open) return
        // setTimeout evita setState síncrono dentro del effect (react-hooks/set-state-in-effect)
        const id = setTimeout(() => void load(), 0)
        return () => clearTimeout(id)
    }, [open, load, refreshKey])

    const resume = async (docId: string) => {
        setResumingId(docId)
        try {
            const ok = await onResume(docId)
            if (ok) onOpenChange(false)
        } finally {
            setResumingId(null)
        }
    }

    const discard = async () => {
        const target = discardTarget
        if (!target || discarding) return
        const requestId = ++discardKey.current
        pendingCancel.current = getClientOperationKey(pendingCancel.current, { saleId: target.id, reason: "descartada" })
        setDiscarding(true)
        try {
            const res = await fetch(`/api/pos/documents/${target.id}`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reason: "descartada", idempotencyKey: pendingCancel.current.key }),
            })
            const data: { error?: string } | null = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudo descartar")
            if (discardKey.current !== requestId) return
            pendingCancel.current = null
            toast.success(`Suspendida #${target.number} descartada`)
            setDiscardTarget(null)
            void load()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "No se pudo descartar")
        } finally {
            setDiscarding(false)
        }
    }

    return (
        <>
            <Sheet open={open} onOpenChange={onOpenChange}>
                <SheetContent side="right" className="w-full sm:max-w-md p-4">
                    <SheetHeader className="pb-3">
                        <SheetTitle className="flex items-center gap-2">
                            <History className="h-5 w-5" />
                            Ventas suspendidas
                            <Button type="button" variant="ghost" size="icon-sm" onClick={() => void load()} disabled={loading} aria-label="Recargar">
                                <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                            </Button>
                        </SheetTitle>
                    </SheetHeader>
                    {loading && documents.length === 0 ? (
                        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                    ) : documents.length === 0 ? (
                        <p className="py-16 text-center text-sm text-muted-foreground">No hay ventas suspendidas en esta sucursal</p>
                    ) : (
                        <div className="space-y-2">
                            {documents.map(doc => (
                                <div key={doc.id} className="rounded-lg border p-3 space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="text-sm font-semibold">
                                            Suspendida #{doc.number}
                                            {doc.kind === "WORKSHOP" && <Badge variant="secondary" className="ml-1.5 text-[10px] px-1">Taller</Badge>}
                                            {doc.itemCount != null && <span className="ml-2 font-normal text-muted-foreground">{doc.itemCount} línea(s)</span>}
                                        </p>
                                        <Badge variant="secondary">{formatPrice(doc.total)}</Badge>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        {formatDate(doc.createdAt)}
                                        {/* El DRAFT no retiene stock: una suspendida vieja es
                                            candidata a descartarse, no un compromiso vivo. */}
                                        {nowMs != null && ` · ${docAgeLabel(doc.createdAt, nowMs)}`}
                                        {doc.customer?.name ? ` · ${doc.customer.name}` : " · Mostrador"}
                                        {doc.note ? ` · “${doc.note}”` : ""}
                                    </p>
                                    <div className="flex gap-1.5">
                                        <Button
                                            type="button" size="sm" className="flex-1"
                                            disabled={resumingId !== null}
                                            onClick={() => void resume(doc.id)}
                                        >
                                            {resumingId === doc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                                            Recuperar
                                        </Button>
                                        <Button
                                            type="button" variant="ghost" size="sm"
                                            className="text-destructive hover:text-destructive"
                                            disabled={resumingId !== null}
                                            onClick={() => setDiscardTarget(doc)}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                            Descartar
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </SheetContent>
            </Sheet>

            <AlertDialog open={discardTarget !== null} onOpenChange={o => { if (!o && !discarding) setDiscardTarget(null) }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Descartar venta suspendida #{discardTarget?.number}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Se eliminará el documento suspendido por {formatPrice(discardTarget?.total ?? 0)}. Esta acción no se puede deshacer.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={discarding}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" disabled={discarding} onClick={() => void discard()}>
                            {discarding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Descartar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
