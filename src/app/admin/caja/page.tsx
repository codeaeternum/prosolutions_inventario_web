"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { formatPrice, formatDate } from "@/lib/utils"
import { 
    Wallet, 
    ArrowUpCircle, 
    ArrowDownCircle, 
    Lock, 
    Unlock,
    History
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
    openedBy: { name: string }
    movements: Movement[]
}

export default function CajaPage() {
    const [register, setRegister] = useState<Register | null>(null)
    const [loading, setLoading] = useState(true)
    
    // Modales / inputs
    const [openAmount, setOpenAmount] = useState("")
    const [movAmount, setMovAmount] = useState("")
    const [movType, setMovType] = useState<"IN" | "OUT">("IN")
    const [movDesc, setMovDesc] = useState("")
    
    const [closeAmount, setCloseAmount] = useState("")
    const [closeNotes, setCloseNotes] = useState("")

    const fetchRegister = async () => {
        try {
            const res = await fetch('/api/caja')
            const data = await res.json()
            if (data.active) {
                setRegister(data.register)
                setCloseAmount(data.register.calculatedTotal.toString())
            } else {
                setRegister(null)
            }
        } catch (e) {
            toast.error("Error al cargar la caja")
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchRegister()
    }, [])

    const handleOpen = async () => {
        try {
            const res = await fetch('/api/caja', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: "OPEN", amount: parseFloat(openAmount) || 0 })
            })
            if (res.ok) {
                toast.success("Caja abierta correctamente")
                fetchRegister()
            } else {
                toast.error("Error al abrir la caja")
            }
        } catch (e) {
            toast.error("Error de conexión")
        }
    }

    const handleClose = async () => {
        if (!confirm("¿Seguro que deseas cerrar la caja?")) return
        try {
            const res = await fetch('/api/caja', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    action: "CLOSE", 
                    amount: parseFloat(closeAmount) || 0,
                    description: closeNotes 
                })
            })
            if (res.ok) {
                toast.success("Caja cerrada correctamente")
                fetchRegister()
            } else {
                toast.error("Error al cerrar la caja")
            }
        } catch (e) {
            toast.error("Error de conexión")
        }
    }

    const handleMovement = async () => {
        if (!movAmount || !movDesc) return toast.error("Llena todos los campos")
        try {
            const res = await fetch('/api/caja', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    action: "MOVEMENT", 
                    type: movType,
                    amount: parseFloat(movAmount),
                    description: movDesc 
                })
            })
            if (res.ok) {
                toast.success("Movimiento registrado")
                setMovAmount("")
                setMovDesc("")
                fetchRegister()
            } else {
                toast.error("Error al registrar movimiento")
            }
        } catch (e) {
            toast.error("Error de conexión")
        }
    }

    if (loading) return <div className="p-8 text-center text-muted-foreground">Cargando caja...</div>

    if (!register) {
        return (
            <div className="max-w-md mx-auto mt-12">
                <Card>
                    <CardHeader className="text-center">
                        <div className="mx-auto bg-primary/10 p-3 rounded-full mb-2 w-fit">
                            <Lock className="w-8 h-8 text-primary" />
                        </div>
                        <CardTitle>Caja Cerrada</CardTitle>
                        <CardDescription>Abre la caja para comenzar a operar hoy.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
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
                        <Button className="w-full" onClick={handleOpen}>
                            Abrir Turno
                        </Button>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <Wallet className="h-6 w-6" /> Control de Caja
                </h1>
                <p className="text-muted-foreground">
                    Abierta por {register.openedBy.name} el {formatDate(register.openedAt)}
                </p>
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
                            <Button 
                                variant={movType === "OUT" ? "destructive" : "outline"} 
                                onClick={() => setMovType("OUT")}
                            >
                                <ArrowUpCircle className="w-4 h-4 mr-2" /> Retiro / Gasto
                            </Button>
                        </div>
                        <div className="space-y-2">
                            <Label>Monto</Label>
                            <Input type="number" placeholder="0.00" value={movAmount} onChange={e => setMovAmount(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Concepto</Label>
                            <Input placeholder="Ej. Pago de luz, Compra refacciones..." value={movDesc} onChange={e => setMovDesc(e.target.value)} />
                        </div>
                        <Button className="w-full" onClick={handleMovement}>Registrar</Button>
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
                        <Button variant="destructive" className="w-full mt-4" onClick={handleClose}>
                            Confirmar Cierre de Caja
                        </Button>
                    </CardContent>
                </Card>
            </div>

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