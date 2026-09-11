"use client"

import { useState, useEffect } from "react"
import { signOut } from "next-auth/react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ThemeToggle } from "@/components/theme-toggle"
import {
    User,
    Mail,
    LogOut,
    ShoppingCart,
    Package,
    CalendarCheck,
    Shield,
    Clock,
    Home,
    CreditCard
} from "lucide-react"
import Link from "next/link"
import { useCurrency } from "@/components/currency-provider"

interface UserData {
    name?: string | null
    email?: string | null
    role?: string
    status?: string
    customerType?: string
}

function getStatusBadge(status: string) {
    switch (status) {
        case "APPROVED":
            return <Badge className="bg-green-500">Aprobado</Badge>
        case "PENDING":
            return <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-700 dark:text-yellow-300">Pendiente</Badge>
        case "REJECTED":
            return <Badge variant="destructive">Rechazado</Badge>
        default:
            return <Badge variant="secondary">{status}</Badge>
    }
}

function getCustomerTypeBadge(type: string) {
    switch (type) {
        case "STORE":
            return <Badge variant="secondary">Tienda (Mayoreo)</Badge>
        case "TECHNICIAN":
            return <Badge variant="secondary">Técnico</Badge>
        case "NORMAL":
            return <Badge variant="outline">Cliente Particular</Badge>
        default:
            return <Badge variant="outline">{type}</Badge>
    }
}

export default function PerfilClient({ user }: { user: UserData }) {
    const { formatPrice } = useCurrency()
    const [isLoggingOut, setIsLoggingOut] = useState(false)
    const [credit, setCredit] = useState<{ creditLimit: number | null; creditBalance: number } | null>(null)

    useEffect(() => {
        fetch("/api/credit/balance")
            .then((res) => res.ok ? res.json() : null)
            .then((data) => data && (data.creditLimit != null || data.creditBalance > 0) ? setCredit(data) : setCredit(null))
            .catch(() => setCredit(null))
    }, [])

    const handleLogout = async () => {
        setIsLoggingOut(true)
        await signOut({ callbackUrl: "/" })
    }

    return (
        <div className="min-h-screen bg-muted/40 pb-24">
            {/* Header */}
            <header className="sticky top-0 safe-area-sticky z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="container mx-auto max-w-lg flex h-16 items-center justify-between px-4">
                    <Link href="/" className="flex items-center gap-2">
                        <Home className="h-5 w-5 text-primary" />
                        <span className="font-bold text-lg tracking-tight">Pro-Solutions</span>
                    </Link>
                    <div className="flex items-center gap-3">
                        <ThemeToggle />
                    </div>
                </div>
            </header>

            <main id="main-content" className="container mx-auto max-w-lg px-4 py-6 space-y-6" role="main">
                {/* Welcome & Status */}
                <div className="flex flex-col gap-2 min-w-0">
                    <h1 className="text-2xl font-bold tracking-tight truncate" title={user.name ?? undefined}>
                        Hola, {user.name?.split(" ")[0] ?? "Usuario"}
                    </h1>
                    <div className="flex items-center gap-2 text-muted-foreground text-sm min-w-0">
                        <span className="truncate" title={user.email ?? undefined}>{user.email ?? "—"}</span>
                        {user.role === "ADMIN" && <Badge variant="outline" className="text-xs">Admin</Badge>}
                    </div>
                </div>

                {/* Profile Card */}
                <Card className="border-none shadow-md bg-gradient-to-br from-background to-muted overflow-hidden">
                    <CardContent className="p-6 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center border-2 border-background shadow-sm">
                                <User className="h-7 w-7 text-primary" />
                            </div>
                            <div>
                                <div className="text-sm text-muted-foreground font-medium mb-1">Estado de Cuenta</div>
                                <div className="flex gap-2">
                                    {getStatusBadge(user?.status || "")}
                                    {user?.role !== "ADMIN" && getCustomerTypeBadge(user?.customerType || "")}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Crédito: saldo y límite */}
                {credit != null && (credit.creditBalance > 0 || credit.creditLimit != null) && (
                    <Card className="border-none shadow-md overflow-hidden">
                        <CardContent className="p-4">
                            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-2">
                                <CreditCard className="h-4 w-4" />
                                Línea de crédito
                            </div>
                            <div className="flex flex-col gap-1">
                                {credit.creditBalance > 0 && (
                                    <p className="text-lg font-semibold">
                                        Saldo a pagar: {formatPrice(credit.creditBalance)}
                                    </p>
                                )}
                                {credit.creditLimit != null && credit.creditLimit > 0 && (
                                    <p className="text-sm text-muted-foreground">
                                        Límite: {formatPrice(credit.creditLimit)}
                                    </p>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Account Pending Alert */}
                {user?.status === "PENDING" && (
                    <div className="p-4 bg-yellow-50 dark:bg-yellow-950/30 rounded-xl border border-yellow-200 dark:border-yellow-800/50 shadow-sm">
                        <div className="flex items-start gap-4">
                            <div className="p-2 bg-yellow-100 dark:bg-yellow-900/50 rounded-full">
                                <Clock className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-yellow-900 dark:text-yellow-100 mb-1">
                                    Cuenta en Revisión
                                </h3>
                                <p className="text-sm text-yellow-700 dark:text-yellow-300 leading-relaxed">
                                    Estamos verificando tus datos. Te notificaremos cuando tu cuenta sea aprobada para que puedas realizar pedidos.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Quick Actions Grid */}
                <div className="grid gap-4">
                    <h2 className="text-lg font-semibold">Acciones Rápidas</h2>
                    <div className="grid grid-cols-2 gap-4">
                        {user?.role === "ADMIN" ? (
                            <>
                                <Link href="/admin" className="block">
                                    <Card className="h-full hover:bg-muted/50 transition-colors cursor-pointer border-l-4 border-l-primary">
                                        <CardContent className="p-4 flex flex-col items-start gap-3">
                                            <div className="p-2 rounded-md bg-primary/10">
                                                <Package className="h-5 w-5 text-primary" />
                                            </div>
                                            <div>
                                                <div className="font-semibold">Panel Admin</div>
                                                <div className="text-xs text-muted-foreground">Gestionar todo</div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </Link>
                                <Link href="/admin/reservas" className="block">
                                    <Card className="h-full hover:bg-muted/50 transition-colors cursor-pointer border-l-4 border-l-orange-500">
                                        <CardContent className="p-4 flex flex-col items-start gap-3">
                                            <div className="p-2 rounded-md bg-orange-500/10">
                                                <ShoppingCart className="h-5 w-5 text-orange-500" />
                                            </div>
                                            <div>
                                                <div className="font-semibold">Reservas</div>
                                                <div className="text-xs text-muted-foreground">Ver solicitudes</div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </Link>
                                <Link href="/admin/productos" className="block">
                                    <Card className="h-full hover:bg-muted/50 transition-colors cursor-pointer border-l-4 border-l-blue-500">
                                        <CardContent className="p-4 flex flex-col items-start gap-3">
                                            <div className="p-2 rounded-md bg-blue-500/10">
                                                <Package className="h-5 w-5 text-blue-500" />
                                            </div>
                                            <div>
                                                <div className="font-semibold">Productos</div>
                                                <div className="text-xs text-muted-foreground">Inv. y Precios</div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </Link>
                            </>
                        ) : user?.status === "APPROVED" ? (
                            <>
                                <Link href="/" className="block">
                                    <Card className="h-full hover:bg-muted/50 transition-colors cursor-pointer border-l-4 border-l-primary">
                                        <CardContent className="p-4 flex flex-col items-start gap-3">
                                            <div className="p-2 rounded-md bg-primary/10">
                                                <Package className="h-5 w-5 text-primary" />
                                            </div>
                                            <div>
                                                <div className="font-semibold">Catálogo</div>
                                                <div className="text-xs text-muted-foreground">Ver productos</div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </Link>
                                <Link href="/mis-reservas" className="block">
                                    <Card className="h-full hover:bg-muted/50 transition-colors cursor-pointer border-l-4 border-l-green-500">
                                        <CardContent className="p-4 flex flex-col items-start gap-3">
                                            <div className="p-2 rounded-md bg-green-500/10">
                                                <CalendarCheck className="h-5 w-5 text-green-500" />
                                            </div>
                                            <div>
                                                <div className="font-semibold">Mis Reservas</div>
                                                <div className="text-xs text-muted-foreground">Historial y estado</div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </Link>
                            </>
                        ) : (
                            <div className="col-span-2 py-8 text-center text-muted-foreground bg-muted/30 rounded-lg border border-dashed">
                                <Shield className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                <p>Menú deshabilitado hasta aprobación</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Account Actions */}
                <div className="space-y-3 pt-4">
                    <Button
                        variant="outline"
                        className="w-full justify-start h-12 text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        onClick={handleLogout}
                        disabled={isLoggingOut}
                    >
                        <LogOut className="mr-3 h-5 w-5" />
                        {isLoggingOut ? "Cerrando sesión..." : "Cerrar Sesión"}
                    </Button>
                </div>
            </main>
        </div>
    )
}
