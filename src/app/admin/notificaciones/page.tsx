"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
    Bell,
    CheckCheck,
    Trash2,
    Search,
    ShoppingCart,
    Package,
    Check,
    User,
    AlertTriangle,
    RefreshCw
} from "lucide-react"
import { useNotifications, Notification, NotificationType } from "@/hooks/use-notifications"
import { cn } from "@/lib/utils"

function getNotificationIcon(type: NotificationType) {
    switch (type) {
        case "new_reservation":
            return <ShoppingCart className="h-5 w-5 text-blue-500" />
        case "reservation_updated":
            return <Package className="h-5 w-5 text-yellow-500" />
        case "deposit_received":
            return <Check className="h-5 w-5 text-green-500" />
        case "user_registered":
            return <User className="h-5 w-5 text-purple-500" />
        case "low_stock":
            return <AlertTriangle className="h-5 w-5 text-red-500" />
        default:
            return <Bell className="h-5 w-5" />
    }
}

function getNotificationTypeLabel(type: NotificationType) {
    switch (type) {
        case "new_reservation":
            return "Nueva Reserva"
        case "reservation_updated":
            return "Reserva Actualizada"
        case "deposit_received":
            return "Depósito Recibido"
        case "user_registered":
            return "Nuevo Usuario"
        case "low_stock":
            return "Stock Bajo"
        default:
            return "Notificación"
    }
}

type LowStockProduct = { id: string; name: string; stock: number; minStock: number }

/** Panel permanente: los productos activos con stock <= minStock (fuente: /api/products?lowStock=true). */
function LowStockSection() {
    const [products, setProducts] = useState<LowStockProduct[] | null>(null)

    useEffect(() => {
        let cancelled = false
        fetch("/api/products?lowStock=true&limit=100")
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (!cancelled) setProducts(Array.isArray(data?.products) ? data.products : [])
            })
            .catch(() => {
                if (!cancelled) setProducts([])
            })
        return () => { cancelled = true }
    }, [])

    // Sin datos aún o sin productos bajos: la sección no estorba.
    if (products === null || products.length === 0) return null

    return (
        <Card className="border-amber-300 dark:border-amber-700">
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                    <div>
                        <CardTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
                            <AlertTriangle className="h-5 w-5" />
                            Productos bajo mínimo
                        </CardTitle>
                        <CardDescription>
                            {products.length} producto(s) con existencias en o por debajo del mínimo
                        </CardDescription>
                    </div>
                    <Button size="sm" variant="outline" asChild>
                        <Link href="/admin/inventario">Ir a inventario</Link>
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="pt-0">
                <ul className="divide-y">
                    {products.map((product) => (
                        <li key={product.id} className="flex items-center justify-between gap-3 py-2">
                            <Link href="/admin/inventario" className="font-medium hover:underline truncate">
                                {product.name}
                            </Link>
                            <Badge variant={product.stock === 0 ? "destructive" : "secondary"} className="flex-shrink-0">
                                {product.stock === 0 ? "Sin existencias" : `Quedan ${product.stock} (mín ${product.minStock})`}
                            </Badge>
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    )
}

function formatFullDate(timestamp: string) {
    const date = new Date(timestamp)
    return date.toLocaleString("es-MX", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
    })
}

function NotificationCard({
    notification,
    onMarkAsRead,
}: {
    notification: Notification
    onMarkAsRead: (id: string) => void
}) {
    return (
        <Card
            className={cn(
                "transition-all cursor-pointer hover:shadow-md",
                !notification.read && "border-l-4 border-l-blue-500 bg-blue-50/50 dark:bg-blue-950/20"
            )}
            onClick={() => onMarkAsRead(notification.id)}
        >
            <CardContent className="p-4">
                <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 p-2 rounded-full bg-muted">
                        {getNotificationIcon(notification.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                            <h3 className={cn("font-medium", !notification.read && "font-semibold")}>
                                {notification.title}
                            </h3>
                            <Badge variant="outline" className="flex-shrink-0">
                                {getNotificationTypeLabel(notification.type)}
                            </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                            {notification.message}
                        </p>
                        <p className="text-xs text-muted-foreground mt-2">
                            {formatFullDate(notification.timestamp)}
                        </p>
                    </div>
                    {!notification.read && (
                        <div className="h-3 w-3 rounded-full bg-blue-500 flex-shrink-0" />
                    )}
                </div>
            </CardContent>
        </Card>
    )
}

export default function NotificacionesPage() {
    const [searchQuery, setSearchQuery] = useState("")
    const [filterType, setFilterType] = useState<NotificationType | "all">("all")

    const {
        notifications,
        isConnected,
        unreadCount,
        markAsRead,
        markAllAsRead,
        clearNotifications,
        reconnect,
    } = useNotifications({ playSound: false }) // Don't play sound on this page

    const filteredNotifications = notifications.filter((n) => {
        const matchesSearch =
            n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            n.message.toLowerCase().includes(searchQuery.toLowerCase())
        const matchesType = filterType === "all" || n.type === filterType
        return matchesSearch && matchesType
    })

    const notificationTypes: { value: NotificationType | "all"; label: string }[] = [
        { value: "all", label: "Todas" },
        { value: "new_reservation", label: "Reservas" },
        { value: "deposit_received", label: "Depósitos" },
        { value: "user_registered", label: "Usuarios" },
        { value: "low_stock", label: "Stock Bajo" },
    ]

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Notificaciones</h1>
                    <p className="text-muted-foreground">
                        Historial completo de notificaciones del sistema
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Badge
                        variant={isConnected ? "default" : "destructive"}
                        className={cn(isConnected && "bg-green-500")}
                    >
                        {isConnected ? "Conectado" : "Desconectado"}
                    </Badge>
                    {!isConnected && (
                        <Button size="sm" variant="outline" onClick={reconnect}>
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Reconectar
                        </Button>
                    )}
                </div>
            </div>

            {/* Stats */}
            <div className="grid gap-4 sm:grid-cols-3">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            Total
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{notifications.length}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            Sin Leer
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-blue-600">{unreadCount}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            Leídas
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">
                            {notifications.length - unreadCount}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Productos con existencias en o bajo el mínimo */}
            <LowStockSection />

            {/* Filters and Actions */}
            <Card>
                <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row gap-4">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                            <Input
                                placeholder="Buscar notificaciones..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9"
                            />
                        </div>
                        <div className="flex gap-2 flex-wrap">
                            {notificationTypes.map((type) => (
                                <Button
                                    key={type.value}
                                    size="sm"
                                    variant={filterType === type.value ? "default" : "outline"}
                                    onClick={() => setFilterType(type.value)}
                                >
                                    {type.label}
                                </Button>
                            ))}
                        </div>
                    </div>

                    {notifications.length > 0 && (
                        <div className="flex gap-2 mt-4 pt-4 border-t">
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={markAllAsRead}
                                disabled={unreadCount === 0}
                            >
                                <CheckCheck className="h-4 w-4 mr-2" />
                                Marcar todas como leídas
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={clearNotifications}
                                className="text-red-600 hover:text-red-700"
                            >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Limpiar historial
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Notifications List */}
            <div className="space-y-3">
                {filteredNotifications.length === 0 ? (
                    <Card>
                        <CardContent className="p-12 text-center">
                            <Bell className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                            <h3 className="font-medium text-lg mb-1">No hay notificaciones</h3>
                            <p className="text-sm text-muted-foreground">
                                {searchQuery || filterType !== "all"
                                    ? "No se encontraron notificaciones con los filtros aplicados"
                                    : "Las notificaciones aparecerán aquí cuando lleguen"
                                }
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    filteredNotifications.map((notification) => (
                        <NotificationCard
                            key={notification.id}
                            notification={notification}
                            onMarkAsRead={markAsRead}
                        />
                    ))
                )}
            </div>
        </div>
    )
}
