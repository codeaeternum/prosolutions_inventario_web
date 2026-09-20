"use client"

import { useRef, useState, type MutableRefObject } from "react"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Loader2, Pause } from "lucide-react"

interface SuspendDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** La página hace el POST /api/pos/documents; devuelve true si se suspendió. */
    onConfirm: (note: string) => Promise<boolean>
}

/** Confirma la suspensión del ticket con una nota opcional para reconocerlo. */
export function SuspendDialog({ open, onOpenChange, onConfirm }: SuspendDialogProps) {
    const busyRef = useRef(false)
    return (
        <Dialog open={open} onOpenChange={o => { if (!busyRef.current) onOpenChange(o) }}>
            {/* El formulario se monta al abrir: la nota arranca limpia sin efecto. */}
            {open && <SuspendForm onOpenChange={onOpenChange} onConfirm={onConfirm} busyRef={busyRef} />}
        </Dialog>
    )
}

function SuspendForm({ onOpenChange, onConfirm, busyRef }: {
    onOpenChange: (open: boolean) => void
    onConfirm: (note: string) => Promise<boolean>
    busyRef: MutableRefObject<boolean>
}) {
    const [note, setNote] = useState("")
    const [busy, setBusy] = useState(false)

    const confirm = async () => {
        setBusy(true)
        busyRef.current = true
        try {
            const ok = await onConfirm(note.trim())
            if (ok) onOpenChange(false)
        } finally {
            setBusy(false)
            busyRef.current = false
        }
    }

    return (
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Pause className="h-5 w-5" />
                        Suspender venta
                    </DialogTitle>
                </DialogHeader>
                <div className="space-y-2 py-2">
                    <p className="text-sm text-muted-foreground">
                        El ticket queda guardado como suspendido y puedes recuperarlo después desde «Recuperar».
                    </p>
                    <div className="space-y-1.5">
                        <Label htmlFor="pos-suspend-note">Nota (opcional)</Label>
                        <Textarea
                            id="pos-suspend-note"
                            placeholder="Ej: cliente fue por efectivo, mesa 3…"
                            maxLength={200}
                            rows={2}
                            disabled={busy}
                            value={note}
                            onChange={e => setNote(e.target.value)}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
                    <Button onClick={() => { void confirm() }} disabled={busy}>
                        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Suspender
                    </Button>
                </DialogFooter>
            </DialogContent>
    )
}
