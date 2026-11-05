"use client"

import { Suspense, useState, useEffect, useRef, useCallback } from "react"
import dynamic from "next/dynamic"
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
import { formatPrice, formatDate } from "@/lib/utils"
import {
    Wallet,
    ArrowUpCircle,
    ArrowDownCircle,
    Lock,
    Unlock,
    History,
    ReceiptText,
    Printer,
    Coins,
    Banknote,
    CalendarDays,
    Truck
} from "lucide-react"

const CashRequestsPanel = dynamic(
    () => import("@/components/admin/caja/cash-requests-panel").then((m) => m.CashRequestsPanel),
    { ssr: false }
)
const WeekPanel = dynamic(
    () => import("@/components/admin/caja/week-panel").then((m) => m.WeekPanel),
    { ssr: false }
)
const LesDeboPanel = dynamic(
    () => import("@/components/admin/caja/les-debo-panel").then((m) => m.LesDeboPanel),
    { ssr: false }
)

type PaymentMethod = "CASH" | "CARD" | "TRANSFER" | "CREDIT"

const METHOD_LABELS: Record<string, string> = {
    CASH: "Efectivo", CARD: "Tarjeta", TRANSFER: "Transferencia", CREDIT: "Crédito",
}

// Centro de dinero: pestañas controladas por ?tab= (deep-link). Sin param = Turno actual.
const CAJA_TABS = ["caja", "semana", "solicitudes", "proveedores"] as const
type CajaTab = (typeof CAJA_TABS)[number]

const CAJA_TAB_DESCRIPTIONS: Record<CajaTab, string> = {
    caja: "Apertura de turno, movimientos de efectivo, cobros del día y arqueo de cierre.",
    semana: "Historial de cortes cerrados en los últimos 7 días con efectivo contado, esperado y diferencia.",
    solicitudes: "Salidas de efectivo por gastos sujetas a autorización de un administrador.",
    proveedores: "Cuentas por pagar a proveedores, antigüedad de saldos y registro de abonos.",
}

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

interface ClosureResult {
    registerId: string
    counted: number
    expected: number
    difference: number
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

    // Pestaña activa desde la URL (?tab=caja|semana|solicitudes|proveedores).
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
            <div className="space-y-2">
                <div className="overflow-x-auto pb-2">
                    <TabsList className="flex-nowrap min-w-max">
                        <TabsTrigger value="caja" className="flex items-center gap-2">
                            <Wallet className="h-4 w-4" /> Turno actual
                        </TabsTrigger>
                        <TabsTrigger value="semana" className="flex items-center gap-2">
                            <CalendarDays className="h-4 w-4" /> Cortes (7 días)
                        </TabsTrigger>
                        <TabsTrigger value="solicitudes" className="flex items-center gap-2">
                            <ReceiptText className="h-4 w-4" /> Solicitudes de gasto
                        </TabsTrigger>
                        <TabsTrigger value="proveedores" className="flex items-center gap-2">
                            <Truck className="h-4 w-4" /> Les debo (Proveedores)
                        </TabsTrigger>
                    </TabsList>
                </div>
                <p className="text-sm text-muted-foreground">{CAJA_TAB_DESCRIPTIONS[tab]}</p>
            </div>

            <TabsContent value="caja">
                {loading ? (
                    <div className="p-8 text-center text-muted-foreground">Cargando caja...</div>
                ) : (
                    shiftView
                )}
            </TabsContent>

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

            <TabsContent value="solicitudes" className="space-y-4">
                {branchSelector && <div className="w-full sm:w-56">{branchSelector}</div>}
                <CashRequestsPanel branchId={branchId} isAdmin={isAdmin} userId={userId} onChanged={fetchRegister} />
            </TabsContent>

            <TabsContent value="proveedores">
                <LesDeboPanel isAdmin={isAdmin} />
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
