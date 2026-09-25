"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { TraspasoDialog, type TraspasoProduct } from "@/components/admin/inventario/traspaso-dialog"
import { ArrowLeftRight, Loader2, Search } from "lucide-react"
import { toast } from "sonner"

interface Branch {
    id: string
    name: string
}

interface StockSearchProduct extends TraspasoProduct {
    total: number
    barcode?: string | null
}

interface TraspasoBuscarDialogProps {
    branches: Branch[]
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Empleado: el origen queda fijo en su sucursal; el admin elige ambas. */
    lockedFromId?: string | null
    /** Se llama tras registrar el traspaso para refrescar la lista. */
    onSaved: () => void
}

/**
 * Traspaso global "mover entre sucursales": primero se elige el producto
 * (búsqueda sobre /api/inventory/stock, que devuelve existencias por sucursal)
 * y luego se reutiliza TraspasoDialog para origen → destino.
 */
export function TraspasoBuscarDialog({ branches, lockedFromId, open, onOpenChange, onSaved }: TraspasoBuscarDialogProps) {
    const [search, setSearch] = useState("")
    const [results, setResults] = useState<StockSearchProduct[]>([])
    const [searching, setSearching] = useState(false)
    const [selected, setSelected] = useState<StockSearchProduct | null>(null)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const doSearch = useCallback(async (query: string) => {
        if (query.trim().length < 2) {
            setResults([])
            return
        }
        setSearching(true)
        try {
            const res = await fetch(`/api/inventory/stock?search=${encodeURIComponent(query.trim())}`)
            const data = await res.json().catch(() => null)
            setResults(res.ok ? (data?.products ?? []) : [])
        } catch {
            setResults([])
        } finally {
            setSearching(false)
        }
    }, [])

    useEffect(() => {
        debounceRef.current = setTimeout(() => void doSearch(search), 300)
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    }, [search, doSearch])

    // Reset al cerrar para que la próxima apertura arranque en la búsqueda.
    const handleOpenChange = (next: boolean) => {
        if (!next) {
            setSearch("")
            setResults([])
            setSelected(null)
        }
        onOpenChange(next)
    }

    const pickProduct = (p: StockSearchProduct) => {
        if (!p.branches?.some((b) => b.quantity > 0)) {
            toast.error(`"${p.name}" no tiene existencias para mover.`)
            return
        }
        setSelected(p)
        handleOpenChange(false)
    }

    return (
        <>
            <Dialog open={open} onOpenChange={handleOpenChange}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <ArrowLeftRight className="h-5 w-5 text-muted-foreground" />
                            Mover entre sucursales
                        </DialogTitle>
                        <DialogDescription>
                            Busca el producto cuyas unidades quieres traspasar a otra sucursal.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-1.5 relative pt-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                autoFocus
                                placeholder="Buscar por nombre o código..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-9"
                                aria-label="Buscar producto para traspaso"
                            />
                        </div>
                        <div className="border rounded-lg max-h-64 overflow-y-auto">
                            {searching && results.length === 0 ? (
                                <div className="p-3 flex items-center gap-2 text-sm text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
                                </div>
                            ) : results.length === 0 ? (
                                <p className="p-3 text-sm text-muted-foreground">
                                    {search.trim().length < 2 ? "Escribe al menos 2 letras para buscar." : "Sin resultados."}
                                </p>
                            ) : results.map((p) => (
                                <button
                                    key={p.id}
                                    type="button"
                                    className="w-full text-left p-3 hover:bg-muted border-b last:border-0 flex justify-between items-center gap-2"
                                    onClick={() => pickProduct(p)}
                                >
                                    <div className="min-w-0">
                                        <p className="font-medium truncate">{p.name}</p>
                                        <p className="text-xs text-muted-foreground">{p.barcode || "Sin código"}</p>
                                    </div>
                                    <div className="text-right shrink-0 flex flex-wrap gap-1 justify-end max-w-[45%]">
                                        {p.branches.filter(b => b.quantity > 0).map((b) => (
                                            <span key={b.branchId} className="text-xs bg-muted px-1.5 py-0.5 rounded tabular-nums">
                                                {b.branchName}: {b.quantity}
                                            </span>
                                        ))}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Paso 2: origen/destino con el formulario ya existente. */}
            <TraspasoDialog
                product={selected}
                branches={branches}
                lockedFromId={lockedFromId}
                open={selected !== null}
                onOpenChange={(o) => { if (!o) setSelected(null) }}
                onSaved={onSaved}
            />
        </>
    )
}
