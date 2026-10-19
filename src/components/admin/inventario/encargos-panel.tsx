"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { EmptyState } from "@/components/admin/empty-state"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "sonner"
import { formatDate, formatPrice } from "@/lib/utils"
import { ArrowRight, PackageCheck, PackageSearch, PackageX, ShoppingCart, Check, X, Wrench, Loader2, ClipboardList, Handshake, Search, Store, MessageCircle, LucideIcon } from "lucide-react"
import { hasWhatsAppPhone, openWhatsApp } from "@/lib/whatsapp"

// ============================ Tipos ============================

interface EncargoRow {
    id: string
    description: string
    quantity: number
    deposit: number
    priceQuoted: number | null
    status: string
    supplierNote: string | null
    marketplaceRequestId: string | null
    createdAt: string
    branch: { id: string; name: string } | null
    customer: { id: string; name: string; phone: string | null } | null
    product: { id: string; name: string } | null
    createdBy: { id: string; name: string } | null
    resolvedBy: { id: string; name: string } | null
}
interface CustomerHit { id: string; name: string; phone: string | null }
interface ProductHit { id: string; name: string; retailPrice: number; stock: number }
// Respuesta de GET /api/marketplace/sugerencias (endpoint de otro módulo).
interface AllySuggestion {
    id: string
    name: string
    retailPrice: number
    wholesalePrice?: number | null
    business: { id: string; name: string; slug: string }
    branchNames: string[]
    available: boolean
}

interface ShortageOrder { orderId: string; number: number; qty: number; folio?: string }
interface ShortageRow {
    productId: string
    name: string
    needed: number
    available: number
    shortage: number
    costPrice: number | null
    orders: ShortageOrder[]
}
interface LowStockRow {
    productId: string
    name: string
    stock: number
    minStock: number
    suggested: number
    costPrice: number | null
}
interface ManualRow {
    id: string
    description: string
    quantity: number
    unitCostCents: number
    notes: string | null
    createdAt: string
    product: { id: string; name: string } | null
    createdBy: { id: string; name: string } | null
    purchase: { id: string; number: number } | null
}
interface Needs {
    partsShortage: ShortageRow[]
    lowStock: LowStockRow[]
    manual: ManualRow[]
}

const orderFolio = (number: number) => `OT-${String(number).padStart(6, "0")}`
const cents = (value: number | null | undefined) => Math.round((value ?? 0) * 100)

// Color solo donde hay que actuar: PENDING pide que alguien la pida, READY
// avisa que ya se puede entregar. ORDERED/DELIVERED/CANCELLED quedan neutras.
const ENCARGO_STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "warning" | "success" }> = {
    PENDING: { label: "Pendiente", variant: "warning" },
    ORDERED: { label: "Pedida", variant: "secondary" },
    READY: { label: "Lista para entregar", variant: "success" },
    DELIVERED: { label: "Entregada", variant: "outline" },
    CANCELLED: { label: "Cancelada", variant: "destructive" },
}
const ENCARGO_FILTERS = [
    { value: "", label: "Todos" },
    { value: "PENDING", label: "Pendientes" },
    { value: "ORDERED", label: "Pedidas" },
    { value: "READY", label: "Listas" },
    { value: "DELIVERED", label: "Entregadas" },
    { value: "CANCELLED", label: "Canceladas" },
]

// ====================== Sugerencias del mercado ======================

/**
 * Busca la pieza entre aliados (GET /api/marketplace/sugerencias?q=).
 * Si el endpoint aún no existe o falla, el área simplemente muestra
 * "Sin sugerencias" — nunca rompe el panel.
 */
function AllySuggestions({ query, busy, pending, onPick }: {
    query: string
    /** true mientras CUALQUIER acción del panel está en vuelo (bloquea el botón). */
    busy: boolean
    /** true solo cuando la solicitud al aliado en vuelo salió de ESTE buscador. */
    pending: boolean
    onPick: (suggestion: AllySuggestion) => void
}) {
    const [suggestions, setSuggestions] = useState<AllySuggestion[]>([])
    const [down, setDown] = useState(false)
    const [searching, setSearching] = useState(false)
    const version = useRef(0)

    useEffect(() => {
        const term = query.trim()
        if (term.length < 3) {
            version.current += 1
            const timer = setTimeout(() => { setSuggestions([]); setDown(false); setSearching(false) }, 0)
            return () => clearTimeout(timer)
        }
        const timer = setTimeout(async () => {
            const v = ++version.current
            setSearching(true)
            try {
                const res = await fetch(`/api/marketplace/sugerencias?q=${encodeURIComponent(term)}`)
                const data = await res.json().catch(() => ({}))
                if (v !== version.current) return
                setSuggestions(res.ok ? (data.suggestions ?? []) : [])
                setDown(!res.ok)
            } catch {
                if (v === version.current) { setSuggestions([]); setDown(true) }
            } finally {
                if (v === version.current) setSearching(false)
            }
        }, 300)
        return () => clearTimeout(timer)
    }, [query])

    if (query.trim().length < 3) return null
    return (
        <div className="rounded-lg border border-dashed p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Store className="h-3.5 w-3.5" /> En el mercado de aliados
                {searching && <Loader2 className="h-3 w-3 animate-spin" />}
            </p>
            {suggestions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                    {searching ? "Buscando…" : down ? "Sin sugerencias por ahora." : "Ningún aliado la tiene publicada."}
                </p>
            ) : (
                <div className="space-y-2">
                    {suggestions.map(s => (
                        <div key={`${s.business.id}:${s.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
                            <div className="min-w-0">
                                <p className="font-medium leading-snug">
                                    {s.business.name} la tiene — {formatPrice(s.wholesalePrice ?? s.retailPrice)}
                                </p>
                                <p className="text-xs text-muted-foreground truncate">
                                    {s.name}
                                    {s.branchNames.length > 0 && ` · ${s.branchNames.join(", ")}`}
                                    {!s.available && " · sin existencias visibles"}
                                </p>
                            </div>
                            <Button type="button" size="sm" variant="outline" disabled={busy || !s.available} onClick={() => onPick(s)}>
                                {pending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Handshake className="h-4 w-4 mr-1" />} Pedirla
                            </Button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

// ============================ Panel ============================

export function EncargosPanel() {
    const router = useRouter()
    const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
    const [branchId, setBranchId] = useState("")
    const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([])
    const [needs, setNeeds] = useState<Needs>({ partsShortage: [], lowStock: [], manual: [] })
    const [loading, setLoading] = useState(true)
    // Nombre del negocio para el mensaje de "Avisar" por WhatsApp (mismo
    // endpoint que usa <BusinessName />; su default es "ProSolutions").
    const [businessName, setBusinessName] = useState("ProSolutions")

    // ---- Encargos de clientes ----
    const [encargos, setEncargos] = useState<EncargoRow[]>([])
    const [encFilter, setEncFilter] = useState("")
    const [viewer, setViewer] = useState<{ role: string; homeBranchId: string | null }>({ role: "ADMIN", homeBranchId: null })
    const isEmployee = viewer.role === "EMPLOYEE"
    const employeeBranch = branches.find(b => b.id === viewer.homeBranchId) ?? null

    // Formulario de nuevo encargo
    const [encDescription, setEncDescription] = useState("")
    const [encQuantity, setEncQuantity] = useState("1")
    const [encDeposit, setEncDeposit] = useState("")
    const [encPrice, setEncPrice] = useState("")
    const [encSupplierNote, setEncSupplierNote] = useState("")
    const [encBranchId, setEncBranchId] = useState("")
    const [customer, setCustomer] = useState<CustomerHit | null>(null)
    const [customerTerm, setCustomerTerm] = useState("")
    const [customerHits, setCustomerHits] = useState<CustomerHit[]>([])
    const [customerOpen, setCustomerOpen] = useState(false)
    const [productPick, setProductPick] = useState<ProductHit | null>(null)
    const [productTerm, setProductTerm] = useState("")
    const [productHits, setProductHits] = useState<ProductHit[]>([])
    const [productOpen, setProductOpen] = useState(false)
    const customerVersion = useRef(0)
    const productVersion = useRef(0)

    // Pedirla a un aliado desde un encargo ya registrado.
    const [allyBoxFor, setAllyBoxFor] = useState<string | null>(null)
    const [allyTerm, setAllyTerm] = useState("")

    // Selección para la orden de compra (lista de compras del almacén).
    // El "stock bajo" ya no se tilda aquí: las sugerencias viven en Entradas
    // y llegan a esta lista como insumos ligados a producto.
    const [partChecked, setPartChecked] = useState<Record<string, boolean>>({})
    const [manualChecked, setManualChecked] = useState<Record<string, boolean>>({})
    const [supplierId, setSupplierId] = useState("none")
    const [ocNotes, setOcNotes] = useState("")
    const [busy, setBusy] = useState(false)
    // Qué acción está en vuelo (para poner el spinner en el botón que la
    // disparó); `busy` sigue bloqueando todo mientras haya una.
    const [pendingKey, setPendingKey] = useState<string | null>(null)

    // Alta manual de insumos
    const [description, setDescription] = useState("")
    const [quantity, setQuantity] = useState("1")
    const [unitCost, setUnitCost] = useState("")
    const [notes, setNotes] = useState("")
    const addKey = useRef<ClientOperationKey | null>(null)
    const ocKey = useRef<ClientOperationKey | null>(null)
    const resolveKeys = useRef<Record<string, ClientOperationKey | null>>({})
    const encargoKey = useRef<ClientOperationKey | null>(null)
    const transitionKeys = useRef<Record<string, ClientOperationKey | null>>({})

    const fetchNeeds = useCallback(async () => {
        try {
            const res = await fetch(`/api/encargos/compras${branchId ? `?branchId=${branchId}` : ""}`)
            const data = await res.json()
            if (res.ok) setNeeds({ partsShortage: data.partsShortage ?? [], lowStock: data.lowStock ?? [], manual: data.manual ?? [] })
        } catch {
            toast.error("Error al cargar la lista de compras")
        } finally {
            setLoading(false)
        }
    }, [branchId])

    const fetchEncargos = useCallback(async () => {
        try {
            const res = await fetch(`/api/encargos${encFilter ? `?status=${encFilter}` : ""}`)
            const data = await res.json().catch(() => ({}))
            if (res.ok) {
                setEncargos(data.encargos ?? [])
                if (data.viewer) setViewer(data.viewer)
            }
        } catch {
            toast.error("Error al cargar los encargos de clientes")
        }
    }, [encFilter])

    useEffect(() => {
        fetch("/api/branches").then(r => (r.ok ? r.json() : null)).then(d => {
            const list = (d?.branches ?? []).filter((b: { isActive: boolean }) => b.isActive)
            setBranches(list)
            if (list.length) {
                setBranchId(prev => prev || list[0].id)
                setEncBranchId(prev => prev || list[0].id)
            }
        }).catch(() => {})
        fetch("/api/suppliers").then(r => (r.ok ? r.json() : null)).then(d => {
            setSuppliers((d?.suppliers ?? []).filter((s: { isActive: boolean }) => s.isActive))
        }).catch(() => {})
        fetch("/api/business").then(r => (r.ok ? r.json() : null)).then(d => {
            if (typeof d?.name === "string" && d.name.trim()) setBusinessName(d.name.trim())
        }).catch(() => {})
    }, [])

    useEffect(() => {
        const timer = setTimeout(() => { if (branchId || branches.length === 0) void fetchNeeds() }, 0)
        return () => clearTimeout(timer)
    }, [branchId, branches.length, fetchNeeds])

    useEffect(() => {
        const timer = setTimeout(() => { void fetchEncargos() }, 0)
        return () => clearTimeout(timer)
    }, [fetchEncargos])

    // Búsqueda de cliente para ligar el encargo (debounce 300 ms).
    useEffect(() => {
        const term = customerTerm.trim()
        if (term.length < 2 || customer) {
            customerVersion.current += 1
            const timer = setTimeout(() => { setCustomerHits([]); setCustomerOpen(false) }, 0)
            return () => clearTimeout(timer)
        }
        const timer = setTimeout(async () => {
            const v = ++customerVersion.current
            try {
                const res = await fetch(`/api/encargos/clientes?q=${encodeURIComponent(term)}`)
                const data = await res.json().catch(() => ({}))
                if (v !== customerVersion.current) return
                setCustomerHits(res.ok ? data.customers ?? [] : [])
                setCustomerOpen(true)
            } catch {
                if (v === customerVersion.current) { setCustomerHits([]); setCustomerOpen(true) }
            }
        }, 300)
        return () => clearTimeout(timer)
    }, [customerTerm, customer])

    // Búsqueda de pieza del catálogo propio (opcional, debounce 300 ms).
    useEffect(() => {
        const term = productTerm.trim()
        if (term.length < 2 || productPick) {
            productVersion.current += 1
            const timer = setTimeout(() => { setProductHits([]); setProductOpen(false) }, 0)
            return () => clearTimeout(timer)
        }
        const timer = setTimeout(async () => {
            const v = ++productVersion.current
            try {
                const res = await fetch(`/api/products?search=${encodeURIComponent(term)}&limit=8`)
                const data = await res.json().catch(() => ({}))
                if (v !== productVersion.current) return
                setProductHits(res.ok ? (data.products ?? []).map((p: { id: string; name: string; retailPrice: number; stock: number }) => ({ id: p.id, name: p.name, retailPrice: p.retailPrice, stock: p.stock })) : [])
                setProductOpen(true)
            } catch {
                if (v === productVersion.current) { setProductHits([]); setProductOpen(true) }
            }
        }, 300)
        return () => clearTimeout(timer)
    }, [productTerm, productPick])

    // ---- Encargos de clientes: alta ----
    const encargoPayload = () => {
        const qty = parseInt(encQuantity, 10)
        const deposit = encDeposit.trim() === "" ? 0 : parseFloat(encDeposit)
        const priceQuoted = encPrice.trim() === "" ? undefined : parseFloat(encPrice)
        return {
            description: encDescription.trim(),
            quantity: Number.isInteger(qty) ? qty : NaN,
            deposit,
            priceQuoted,
            customerId: customer?.id,
            productId: productPick?.id,
            branchId: isEmployee ? (viewer.homeBranchId ?? undefined) : (encBranchId || undefined),
            supplierNote: encSupplierNote.trim() || undefined,
        }
    }

    const createEncargo = async (): Promise<EncargoRow | null> => {
        const payload = encargoPayload()
        if (!payload.description) { toast.error("Describe la pieza que encarga el cliente"); return null }
        if (!Number.isInteger(payload.quantity) || payload.quantity < 1 || payload.quantity > 9999) {
            toast.error("La cantidad debe ser un entero entre 1 y 9,999"); return null
        }
        if (!Number.isFinite(payload.deposit) || payload.deposit < 0) { toast.error("El anticipo no es válido"); return null }
        if (Math.abs(payload.deposit * 100 - Math.round(payload.deposit * 100)) > 0.000001) {
            toast.error("El anticipo admite hasta dos decimales"); return null
        }
        if (payload.priceQuoted !== undefined) {
            if (!Number.isFinite(payload.priceQuoted) || payload.priceQuoted < 0) { toast.error("El precio cotizado no es válido"); return null }
            if (Math.abs(payload.priceQuoted * 100 - Math.round(payload.priceQuoted * 100)) > 0.000001) {
                toast.error("El precio cotizado admite hasta dos decimales"); return null
            }
        }
        encargoKey.current = getClientOperationKey(encargoKey.current, payload)
        const res = await fetch("/api/encargos", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, idempotencyKey: encargoKey.current.key }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || "No se pudo registrar el encargo")
        encargoKey.current = null
        return data.encargo as EncargoRow
    }

    const resetEncargoForm = () => {
        setEncDescription(""); setEncQuantity("1"); setEncDeposit(""); setEncPrice(""); setEncSupplierNote("")
        setCustomer(null); setCustomerTerm(""); setProductPick(null); setProductTerm("")
    }

    const submitEncargo = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (busy) return
        setBusy(true)
        setPendingKey("encargo:new")
        try {
            const created = await createEncargo()
            if (!created) return
            toast.success("Encargo registrado")
            resetEncargoForm()
            await fetchEncargos()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Error de conexión. Reintenta sin cambiar los datos.")
        } finally {
            setBusy(false)
            setPendingKey(null)
        }
    }

    /** Transición de estado con llave idempotente por encargo+acción. */
    const transitionEncargo = async (item: EncargoRow, action: "ORDERED" | "READY" | "DELIVERED" | "CANCELLED", extra: Record<string, unknown> = {}) => {
        const key = `${item.id}:${action}`
        const payload = { action, ...extra }
        transitionKeys.current[key] = getClientOperationKey(transitionKeys.current[key] ?? null, payload)
        const res = await fetch(`/api/encargos/${item.id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, idempotencyKey: transitionKeys.current[key]!.key }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || "No se pudo actualizar el encargo")
        transitionKeys.current[key] = null
        return data
    }

    /**
     * "Pedirla" a un aliado del mercado: UNA sola llamada atómica — POST
     * /api/marketplace/requests con `encargoId` crea la solicitud Y pasa el
     * encargo a ORDERED ligando marketplaceRequestId en la misma operación
     * (antes eran POST + PATCH y un fallo a la mitad dejaba la solicitud
     * registrada con el encargo pendiente). Si `item` es null, primero crea
     * el encargo con lo capturado en el formulario.
     */
    const orderFromAlly = async (item: EncargoRow | null, suggestion: AllySuggestion) => {
        if (busy) return
        setBusy(true)
        setPendingKey(`ally:${item?.id ?? "form"}`)
        try {
            let target = item
            if (!target) {
                target = await createEncargo()
                if (!target) return
            }
            const payload = {
                productId: suggestion.id,
                qty: target.quantity,
                encargoId: target.id,
                // Sin tallerName: en pedidos a OTRO negocio el servidor lo
                // deriva del nombre de nuestro negocio (somos quien pide).
                note: `Encargo de cliente${target.customer ? ` (${target.customer.name})` : ""}: ${target.description}`,
                supplierNote: `Pedida a ${suggestion.business.name}`,
            }
            // Llave por encargo: reintentar tras un fallo de red devuelve el
            // recibo guardado en vez de abrir una segunda solicitud.
            const keySlot = `ally:${target.id}`
            transitionKeys.current[keySlot] = getClientOperationKey(transitionKeys.current[keySlot] ?? null, payload)
            const res = await fetch("/api/marketplace/requests", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: transitionKeys.current[keySlot]!.key }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(data.error || "El aliado no recibió la solicitud")
            transitionKeys.current[keySlot] = null
            toast.success(`Solicitud enviada a ${suggestion.business.name}`, { description: "El encargo quedó como pedida." })
            if (!item) resetEncargoForm()
            setAllyBoxFor(null)
            await fetchEncargos()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Error de conexión. Reintenta sin cambiar los datos.")
        } finally {
            setBusy(false)
            setPendingKey(null)
        }
    }

    const markEncargo = async (item: EncargoRow, action: "ORDERED" | "READY" | "DELIVERED" | "CANCELLED") => {
        if (busy) return
        setBusy(true)
        setPendingKey(`${item.id}:${action}`)
        try {
            await transitionEncargo(item, action)
            toast.success(
                action === "ORDERED" ? "Encargo marcado como pedida"
                    : action === "READY" ? "Pieza recibida: el encargo está listo para entregar"
                        : action === "DELIVERED" ? "Encargo entregado al cliente"
                            : "Encargo cancelado",
            )
            await fetchEncargos()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Error de conexión. Reintenta sin cambiar los datos.")
        } finally {
            setBusy(false)
            setPendingKey(null)
        }
    }

    // "Avisar": un toque abre WhatsApp con el aviso de pieza lista. Solo se
    // ofrece cuando el encargo está READY y el cliente ligado tiene teléfono.
    const avisarEncargo = (item: EncargoRow) => {
        if (!item.customer || !hasWhatsAppPhone(item.customer.phone)) return
        const pieza = item.quantity > 1 ? `${item.quantity} × ${item.description}` : item.description
        openWhatsApp(item.customer.phone, `Hola ${item.customer.name}, tu pieza ${pieza} ya llegó a ${businessName}. Puedes pasar a recogerla.`)
    }

    // --- Selección → líneas de la OC (lista de compras) ---
    const selectedItems = () =>
        needs.partsShortage
            .filter(row => partChecked[row.productId])
            .map(row => ({ productId: row.productId, quantity: row.shortage, unitCostCents: cents(row.costPrice) }))
    const manualIds = needs.manual.filter(item => manualChecked[item.id]).map(item => item.id)
    const selectionCount = selectedItems().length + manualIds.length

    const addManual = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (busy) return
        const qty = parseInt(quantity, 10)
        if (!description.trim()) return toast.error("Describe qué hay que comprar")
        if (!Number.isInteger(qty) || qty < 1 || qty > 9999) return toast.error("La cantidad debe ser un entero entre 1 y 9,999")
        const cost = unitCost.trim() === "" ? 0 : parseFloat(unitCost)
        if (!Number.isFinite(cost) || cost < 0) return toast.error("El costo estimado no es válido")
        if (Math.abs(cost * 100 - Math.round(cost * 100)) > 0.000001) return toast.error("El costo admite hasta dos decimales")
        setBusy(true)
        setPendingKey("manual:new")
        try {
            const payload = { description: description.trim(), quantity: qty, unitCostCents: Math.round(cost * 100), notes: notes.trim() || undefined }
            addKey.current = getClientOperationKey(addKey.current, payload)
            const res = await fetch("/api/encargos/compras", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: addKey.current.key }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "No se pudo agregar el insumo")
            addKey.current = null
            setDescription(""); setQuantity("1"); setUnitCost(""); setNotes("")
            toast.success("Insumo agregado a la lista")
            await fetchNeeds()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Error de conexión. Reintenta sin cambiar los datos.")
        } finally {
            setBusy(false)
            setPendingKey(null)
        }
    }

    const resolveManual = async (item: ManualRow, action: "PURCHASED" | "CANCELLED") => {
        if (busy) return
        setBusy(true)
        setPendingKey(`manual:${item.id}:${action}`)
        try {
            const payload = { action }
            resolveKeys.current[item.id] = getClientOperationKey(resolveKeys.current[item.id] ?? null, payload)
            const res = await fetch(`/api/encargos/compras/${item.id}`, {
                method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: resolveKeys.current[item.id]!.key }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "No se pudo actualizar el insumo")
            resolveKeys.current[item.id] = null
            toast.success(action === "PURCHASED" ? "Insumo marcado como comprado" : "Insumo cancelado")
            await fetchNeeds()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Error de conexión. Reintenta sin cambiar los datos.")
        } finally {
            setBusy(false)
            setPendingKey(null)
        }
    }

    const generatePurchase = async () => {
        if (busy) return
        const items = selectedItems()
        if (!items.length && !manualIds.length) return toast.error("Tilda al menos un renglón para la orden de compra")
        if (!items.length) return toast.error("La orden de compra necesita al menos un producto del catálogo; los insumos sin producto se marcan aparte con «Comprado»")
        if (!branchId) return toast.error("Selecciona la sucursal destino de la compra")
        setBusy(true)
        setPendingKey("oc")
        try {
            const payload = { branchId, supplierId: supplierId === "none" ? undefined : supplierId, notes: ocNotes.trim() || undefined, items, manualItemIds: manualIds }
            ocKey.current = getClientOperationKey(ocKey.current, payload)
            const res = await fetch("/api/encargos/orden-compra", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: ocKey.current.key }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "No se pudo generar la orden de compra")
            ocKey.current = null
            setPartChecked({}); setManualChecked({}); setOcNotes("")
            toast.success(`Orden de compra ${data.folio} creada en borrador`, {
                description: data.linkedManualItems ? `${data.linkedManualItems} insumo(s) marcados como comprados` : undefined,
                action: { label: "Ver compras", onClick: () => router.push("/admin/inventario?tab=compras") },
            })
            await fetchNeeds()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Error de conexión. Reintenta sin cambiar los datos.")
        } finally {
            setBusy(false)
            setPendingKey(null)
        }
    }

    /** Icono del botón: mientras SU acción está en vuelo muestra el spinner. */
    const pendingIcon = (key: string, Icon: LucideIcon) =>
        pendingKey === key
            ? <Loader2 className="w-4 h-4 mr-1 animate-spin" aria-hidden />
            : <Icon className="w-4 h-4 mr-1" aria-hidden />

    const branchSelector = branches.length > 1 ? (
        <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="w-full sm:w-56" aria-label="Sucursal de la lista de compras">
                <SelectValue placeholder="Sucursal" />
            </SelectTrigger>
            <SelectContent>
                {branches.map(b => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    ) : null

    if (loading) {
        return (
            <div className="flex items-center justify-center gap-2 p-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                Cargando encargos…
            </div>
        )
    }

    return (
        <div className="space-y-6 pb-24 lg:pb-6">
            {/* Toolbar: qué es esta pestaña + sucursal de la lista de compras */}
            <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-muted-foreground">
                    Piezas que encargan clientes y, abajo, la lista de compras del almacén.
                </p>
                {branchSelector && <div className="w-full sm:ml-auto sm:w-auto">{branchSelector}</div>}
            </div>

            {/* Resumen de lo que pide atención — color solo donde hay que
                actuar; "bajo mínimo" lleva a las sugerencias de Entradas. */}
            {(needs.partsShortage.length > 0 || needs.lowStock.length > 0 || needs.manual.length > 0) && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {needs.partsShortage.length > 0 && (
                        <span>
                            <span className="font-semibold text-destructive tabular-nums">{needs.partsShortage.length}</span>{" "}
                            producto{needs.partsShortage.length === 1 ? "" : "s"} faltante{needs.partsShortage.length === 1 ? "" : "s"} en órdenes abiertas
                        </span>
                    )}
                    {needs.lowStock.length > 0 && (
                        <Link
                            href="/admin/inventario?tab=entradas"
                            title="Ver las sugerencias de compra en Entradas"
                            className="rounded-sm underline-offset-2 hover:underline"
                        >
                            <span className="font-semibold text-amber-600 dark:text-amber-400 tabular-nums">{needs.lowStock.length}</span>{" "}
                            bajo mínimo
                        </Link>
                    )}
                    {needs.manual.length > 0 && (
                        <span>
                            <span className="font-semibold text-foreground tabular-nums">{needs.manual.length}</span>{" "}
                            insumo{needs.manual.length === 1 ? "" : "s"} por comprar
                        </span>
                    )}
                </div>
            )}

            {/* ============ Encargos de clientes ============ */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2"><ClipboardList className="h-5 w-5 text-muted-foreground" /> Encargos de clientes</CardTitle>
                    <CardDescription>
                        Piezas que un cliente pide y no tenemos en stock: se registran, se piden al
                        proveedor o a un aliado del mercado, y se entregan cuando llegan.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                    {/* Alta de encargo */}
                    <form onSubmit={e => void submitEncargo(e)} className="space-y-3 rounded-lg border p-3">
                        <div className="grid gap-3 sm:grid-cols-[1fr_6rem_8rem_9rem]">
                            <div className="space-y-2">
                                <Label htmlFor="enc-desc">Qué pieza busca *</Label>
                                <Input
                                    id="enc-desc"
                                    maxLength={300}
                                    placeholder="Ej. Pantalla iPhone 12 original"
                                    value={encDescription}
                                    onChange={e => setEncDescription(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="enc-qty">Cantidad</Label>
                                <Input id="enc-qty" type="number" min="1" max="9999" step="1" value={encQuantity} onChange={e => setEncQuantity(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="enc-price">Precio cotizado $</Label>
                                <Input id="enc-price" type="number" min="0" step="0.01" placeholder="Opcional" value={encPrice} onChange={e => setEncPrice(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="enc-deposit">Anticipo $</Label>
                                <Input id="enc-deposit" type="number" min="0" step="0.01" placeholder="0.00" value={encDeposit} onChange={e => setEncDeposit(e.target.value)} />
                            </div>
                        </div>

                        {/* Sugerencias del mercado según la descripción capturada */}
                        <AllySuggestions query={encDescription} busy={busy} pending={pendingKey === "ally:form"} onPick={s => void orderFromAlly(null, s)} />

                        <div className="grid gap-3 sm:grid-cols-2">
                            {/* Cliente opcional con buscador */}
                            <div className="space-y-2 relative">
                                <Label htmlFor="enc-customer">Cliente (opcional)</Label>
                                {customer ? (
                                    <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 h-9 text-sm">
                                        <span className="truncate">{customer.name}{customer.phone ? ` · ${customer.phone}` : ""}</span>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 px-2"
                                            title="Quitar cliente"
                                            aria-label="Quitar cliente"
                                            onClick={() => { setCustomer(null); setCustomerTerm("") }}
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                ) : (
                                    <>
                                        <Input
                                            id="enc-customer"
                                            placeholder="Nombre o teléfono del cliente"
                                            value={customerTerm}
                                            onChange={e => setCustomerTerm(e.target.value)}
                                            onFocus={() => customerHits.length > 0 && setCustomerOpen(true)}
                                        />
                                        {customerOpen && customerTerm.trim().length >= 2 && (
                                            <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-md">
                                                {customerHits.length === 0 ? (
                                                    <p className="px-3 py-2 text-xs text-muted-foreground">Sin coincidencias</p>
                                                ) : customerHits.map(hit => (
                                                    <button
                                                        key={hit.id}
                                                        type="button"
                                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                                                        onClick={() => { setCustomer(hit); setCustomerHits([]); setCustomerOpen(false); setCustomerTerm("") }}
                                                    >
                                                        <span className="truncate">{hit.name}</span>
                                                        {hit.phone && <span className="text-xs text-muted-foreground">{hit.phone}</span>}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

                            {/* Pieza del catálogo propio (opcional) */}
                            <div className="space-y-2 relative">
                                <Label htmlFor="enc-product">Pieza del catálogo (opcional)</Label>
                                {productPick ? (
                                    <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 h-9 text-sm">
                                        <span className="truncate">{productPick.name}</span>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 px-2"
                                            title="Quitar la pieza del catálogo"
                                            aria-label="Quitar la pieza del catálogo"
                                            onClick={() => { setProductPick(null); setProductTerm("") }}
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                ) : (
                                    <>
                                        <Input
                                            id="enc-product"
                                            placeholder="Buscar en el catálogo"
                                            value={productTerm}
                                            onChange={e => setProductTerm(e.target.value)}
                                            onFocus={() => productHits.length > 0 && setProductOpen(true)}
                                        />
                                        {productOpen && productTerm.trim().length >= 2 && (
                                            <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-md">
                                                {productHits.length === 0 ? (
                                                    <p className="px-3 py-2 text-xs text-muted-foreground">Sin coincidencias</p>
                                                ) : productHits.map(hit => (
                                                    <button
                                                        key={hit.id}
                                                        type="button"
                                                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                                                        onClick={() => {
                                                            setProductPick(hit)
                                                            setProductHits([]); setProductOpen(false); setProductTerm("")
                                                            if (!encDescription.trim()) setEncDescription(hit.name)
                                                        }}
                                                    >
                                                        <span className="truncate">{hit.name}</span>
                                                        <span className="text-xs text-muted-foreground shrink-0">stock {hit.stock}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                            <div className="space-y-2">
                                <Label id="enc-branch-label">Sucursal</Label>
                                {isEmployee ? (
                                    <div className="flex h-9 items-center rounded-md border bg-muted/50 px-3 text-sm">
                                        {employeeBranch?.name ?? "Tu sucursal"}
                                    </div>
                                ) : (
                                    <Select value={encBranchId} onValueChange={setEncBranchId}>
                                        <SelectTrigger aria-labelledby="enc-branch-label">
                                            <SelectValue placeholder="Sucursal que recibe" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {branches.map(b => (
                                                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="enc-supplier-note">Nota para proveedor (opcional)</Label>
                                <Input id="enc-supplier-note" maxLength={500} placeholder="A quién se le pide, referencia…" value={encSupplierNote} onChange={e => setEncSupplierNote(e.target.value)} />
                            </div>
                            <Button type="submit" disabled={busy}>
                                {pendingKey === "encargo:new" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden /> : null}
                                Registrar encargo
                            </Button>
                        </div>
                    </form>

                    {/* Filtro por estado */}
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar encargos por estado">
                        {ENCARGO_FILTERS.map(f => (
                            <Button
                                key={f.value}
                                type="button"
                                size="sm"
                                variant={encFilter === f.value ? "default" : "outline"}
                                aria-pressed={encFilter === f.value}
                                onClick={() => setEncFilter(f.value)}
                            >
                                {f.label}
                            </Button>
                        ))}
                    </div>

                    {/* Lista de encargos */}
                    {encargos.length === 0 ? (
                        <EmptyState
                            icon={ClipboardList}
                            title={encFilter ? "Sin encargos con este estado" : "Sin encargos registrados"}
                            description={encFilter
                                ? "Prueba con otro filtro de estado."
                                : "Cuando un cliente pida una pieza que no hay en stock, regístrala arriba para darle seguimiento."}
                        />
                    ) : (
                        <div className="space-y-2">
                            {encargos.map(item => {
                                const chip = ENCARGO_STATUS[item.status] ?? { label: item.status, variant: "outline" as const }
                                const trail = [
                                    item.product ? `Catálogo: ${item.product.name}` : null,
                                    item.supplierNote,
                                    item.marketplaceRequestId ? `Solicitud al aliado #${item.marketplaceRequestId.slice(-6)}` : null,
                                ].filter(Boolean).join(" · ")
                                return (
                                    <div
                                        key={item.id}
                                        className="rounded-lg border p-3 text-sm space-y-2.5"
                                        aria-busy={pendingKey?.startsWith(`${item.id}:`) || undefined}
                                    >
                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                            <div className="min-w-0 space-y-0.5">
                                                <p className="font-medium leading-snug break-words">
                                                    <span className="tabular-nums">{item.quantity}</span> × {item.description}
                                                </p>
                                                <p className="text-xs text-muted-foreground break-words">
                                                    {item.customer ? `${item.customer.name}${item.customer.phone ? ` · ${item.customer.phone}` : ""}` : "Sin cliente ligado"}
                                                    {item.branch ? ` · ${item.branch.name}` : ""}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {formatDate(item.createdAt)}{item.createdBy ? ` · registró ${item.createdBy.name}` : ""}
                                                </p>
                                                {(item.priceQuoted != null || item.deposit > 0) && (
                                                    <p className="text-xs text-muted-foreground pt-0.5">
                                                        {item.priceQuoted != null && <>Precio <span className="font-semibold text-foreground tabular-nums">{formatPrice(item.priceQuoted)}</span></>}
                                                        {item.priceQuoted != null && item.deposit > 0 && " · "}
                                                        {item.deposit > 0 && <>Anticipo <span className="font-semibold text-foreground tabular-nums">{formatPrice(item.deposit)}</span></>}
                                                    </p>
                                                )}
                                                {trail && <p className="text-xs text-muted-foreground break-words">{trail}</p>}
                                            </div>
                                            <Badge variant={chip.variant} className="shrink-0">{chip.label}</Badge>
                                        </div>

                                        {/* Buscador de aliados para este encargo */}
                                        {allyBoxFor === item.id && (
                                            <div className="space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <Search className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                                                    <Input
                                                        value={allyTerm}
                                                        onChange={e => setAllyTerm(e.target.value)}
                                                        placeholder="Buscar la pieza entre aliados"
                                                        aria-label="Buscar la pieza entre aliados"
                                                        className="h-8"
                                                    />
                                                </div>
                                                <AllySuggestions query={allyTerm} busy={busy} pending={pendingKey === `ally:${item.id}`} onPick={s => void orderFromAlly(item, s)} />
                                            </div>
                                        )}

                                        {/* Siguiente paso del flujo como acción principal; cancelar queda discreto. */}
                                        <div className="flex flex-wrap gap-2">
                                            {item.status === "PENDING" && (
                                                <>
                                                    <Button size="sm" disabled={busy} onClick={() => void markEncargo(item, "ORDERED")}>
                                                        {pendingIcon(`${item.id}:ORDERED`, ShoppingCart)} Pedida al proveedor
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        disabled={busy}
                                                        aria-expanded={allyBoxFor === item.id}
                                                        onClick={() => {
                                                            setAllyBoxFor(prev => prev === item.id ? null : item.id)
                                                            setAllyTerm(item.description)
                                                        }}
                                                    >
                                                        <Store className="w-4 h-4 mr-1" aria-hidden /> {allyBoxFor === item.id ? "Cerrar aliados" : "Buscar en aliados"}
                                                    </Button>
                                                </>
                                            )}
                                            {item.status === "ORDERED" && (
                                                <Button size="sm" disabled={busy} onClick={() => void markEncargo(item, "READY")}>
                                                    {pendingIcon(`${item.id}:READY`, Check)} Llegó
                                                </Button>
                                            )}
                                            {item.status === "READY" && (
                                                <>
                                                    {hasWhatsAppPhone(item.customer?.phone) && (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            disabled={busy}
                                                            title={`Avisar a ${item.customer?.name} por WhatsApp`}
                                                            aria-label={`Avisar a ${item.customer?.name} por WhatsApp`}
                                                            onClick={() => avisarEncargo(item)}
                                                        >
                                                            <MessageCircle className="w-4 h-4 mr-1" aria-hidden /> Avisar
                                                        </Button>
                                                    )}
                                                    <Button size="sm" disabled={busy} onClick={() => void markEncargo(item, "DELIVERED")}>
                                                        {pendingIcon(`${item.id}:DELIVERED`, Check)} Entregada
                                                    </Button>
                                                </>
                                            )}
                                            {["PENDING", "ORDERED", "READY", "DELIVERED"].includes(item.status) && (
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                                    disabled={busy}
                                                    onClick={() => void markEncargo(item, "CANCELLED")}
                                                >
                                                    {pendingIcon(`${item.id}:CANCELLED`, X)} Cancelar
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* ============ Lista de compras del almacén ============ */}
            <h2 className="pt-2 text-sm font-medium text-muted-foreground">Para comprar (almacén)</h2>

            {/* Refacciones faltantes en órdenes abiertas */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2"><Wrench className="h-5 w-5 text-muted-foreground" /> Refacciones faltantes en órdenes</CardTitle>
                    <CardDescription>
                        Piezas ligadas a producto pedidas por órdenes de reparación abiertas y que el stock{branchId ? " de esta sucursal" : ""} no alcanza a cubrir.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {needs.partsShortage.length === 0 ? (
                        <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                            <PackageCheck className="h-4 w-4" aria-hidden />
                            Ninguna orden abierta está esperando refacciones.
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-10"></TableHead>
                                        <TableHead>Producto</TableHead>
                                        <TableHead className="text-right">Necesario</TableHead>
                                        <TableHead className="text-right">Disponible</TableHead>
                                        <TableHead className="text-right">Falta</TableHead>
                                        <TableHead>Órdenes</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {needs.partsShortage.map(row => (
                                        <TableRow key={row.productId}>
                                            <TableCell>
                                                <Checkbox
                                                    checked={Boolean(partChecked[row.productId])}
                                                    onCheckedChange={value => setPartChecked(prev => ({ ...prev, [row.productId]: value === true }))}
                                                    aria-label={`Agregar ${row.name} a la orden de compra`}
                                                />
                                            </TableCell>
                                            <TableCell className="font-medium">{row.name}</TableCell>
                                            <TableCell className="text-right tabular-nums">{row.needed}</TableCell>
                                            <TableCell className="text-right tabular-nums">{row.available}</TableCell>
                                            <TableCell className="text-right">
                                                <Badge variant="destructive" className="tabular-nums">{row.shortage}</Badge>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-wrap gap-1">
                                                    {row.orders.map(order => (
                                                        <Badge key={order.orderId} variant="outline" className="font-normal tabular-nums">
                                                            {/* La API ya trae el folio con los dígitos del negocio; orderFolio es el respaldo. */}
                                                            {order.folio ?? orderFolio(order.number)} ×{order.qty}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Stock bajo: la tabla duplicaba las "Sugerencias de compra" de
                Entradas (mismo aviso, allá con rotación y aliados). Aquí solo
                queda el aviso + el puente; lo que se agregue desde Entradas
                llega a esta lista como insumo ligado a producto. */}
            {needs.lowStock.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm">
                    <PackageX className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                    <p className="min-w-0 flex-1 basis-52 text-muted-foreground">
                        Hay <span className="font-semibold text-amber-600 dark:text-amber-400 tabular-nums">{needs.lowStock.length}</span>{" "}
                        producto{needs.lowStock.length === 1 ? "" : "s"} bajo mínimo{branchId ? " en esta sucursal" : ""}.
                    </p>
                    <Button asChild variant="outline" size="sm">
                        <Link href="/admin/inventario?tab=entradas">
                            Ver sugerencias de compra
                            <ArrowRight className="h-4 w-4" aria-hidden />
                        </Link>
                    </Button>
                </div>
            )}

            {/* Insumos y otros */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2"><PackageSearch className="h-5 w-5 text-muted-foreground" /> Insumos y otros</CardTitle>
                    <CardDescription>Cosas que no salen del catálogo: alcohol, cinta, herramientas, consumibles.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                    <form onSubmit={e => void addManual(e)} className="grid gap-3 sm:grid-cols-[1fr_6rem_8rem_1fr_auto] sm:items-end">
                        <div className="space-y-2">
                            <Label htmlFor="man-desc">Descripción</Label>
                            <Input id="man-desc" maxLength={200} placeholder="Ej. Alcohol isopropílico 1L" value={description} onChange={e => setDescription(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="man-qty">Cantidad</Label>
                            <Input id="man-qty" type="number" min="1" max="9999" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="man-cost">Costo est.</Label>
                            <Input id="man-cost" type="number" min="0" step="0.01" placeholder="0.00" value={unitCost} onChange={e => setUnitCost(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="man-notes">Notas</Label>
                            <Input id="man-notes" maxLength={500} placeholder="Opcional" value={notes} onChange={e => setNotes(e.target.value)} />
                        </div>
                        <Button type="submit" disabled={busy}>
                            {pendingKey === "manual:new" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" aria-hidden /> : null}
                            Agregar
                        </Button>
                    </form>

                    {needs.manual.length === 0 ? (
                        <p className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                            <PackageCheck className="h-4 w-4" aria-hidden />
                            Sin insumos pendientes de compra.
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {needs.manual.map(item => (
                                <div
                                    key={item.id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                                    aria-busy={pendingKey?.startsWith(`manual:${item.id}:`) || undefined}
                                >
                                    <div className="flex items-start gap-3 min-w-0">
                                        <Checkbox
                                            className="mt-1"
                                            checked={Boolean(manualChecked[item.id])}
                                            onCheckedChange={value => setManualChecked(prev => ({ ...prev, [item.id]: value === true }))}
                                            aria-label={`Ligar ${item.description} a la orden de compra`}
                                        />
                                        <div className="min-w-0">
                                            <p className="font-medium break-words">
                                                <span className="tabular-nums">{item.quantity}</span> × {item.description}
                                                {item.unitCostCents > 0 && <span className="text-muted-foreground font-normal tabular-nums"> · {formatPrice(item.unitCostCents / 100)} c/u</span>}
                                            </p>
                                            <p className="text-xs text-muted-foreground break-words">
                                                {item.createdBy?.name ?? "—"} · {formatDate(item.createdAt)}
                                                {item.product ? ` · catálogo: ${item.product.name}` : ""}
                                                {item.notes ? ` — ${item.notes}` : ""}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button size="sm" disabled={busy} onClick={() => void resolveManual(item, "PURCHASED")}>
                                            {pendingIcon(`manual:${item.id}:PURCHASED`, Check)} Comprado
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                            disabled={busy}
                                            onClick={() => void resolveManual(item, "CANCELLED")}
                                        >
                                            {pendingIcon(`manual:${item.id}:CANCELLED`, X)} Cancelar
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Barra de generación de OC */}
            <div className="sticky bottom-4 z-10">
                <Card className="border-primary/30 shadow-lg">
                    <CardContent className="p-4 flex flex-col lg:flex-row lg:items-center gap-3">
                        <p className="text-sm font-medium flex-1 tabular-nums" aria-live="polite">
                            {selectionCount > 0
                                ? `${selectedItems().length} producto(s) y ${manualIds.length} insumo(s) seleccionados`
                                : "Tilda productos o insumos para armar la orden de compra"}
                        </p>
                        <Select value={supplierId} onValueChange={setSupplierId}>
                            <SelectTrigger className="w-full lg:w-56" aria-label="Proveedor para la orden de compra (opcional)">
                                <SelectValue placeholder="Proveedor (opcional)" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">Sin proveedor</SelectItem>
                                {suppliers.map(s => (
                                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Input
                            className="w-full lg:w-64"
                            maxLength={1000}
                            placeholder="Notas para la OC (opcional)"
                            aria-label="Notas para la orden de compra (opcional)"
                            value={ocNotes}
                            onChange={e => setOcNotes(e.target.value)}
                        />
                        <Button onClick={() => void generatePurchase()} disabled={busy || selectionCount === 0}>
                            {pendingKey === "oc"
                                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden />
                                : <ShoppingCart className="w-4 h-4 mr-2" aria-hidden />}
                            Generar orden de compra
                        </Button>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
