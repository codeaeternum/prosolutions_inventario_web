"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Bell, Check, CheckCheck, Package, ShoppingCart, User, AlertTriangle, X, Wrench, Store, Clock, ShieldAlert } from "lucide-react"
import { useNotifications, notificationHref, Notification, NotificationType } from "@/hooks/use-notifications"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function getNotificationIcon(type: NotificationType) {
  switch (type) {
    case "new_reservation":
      return <ShoppingCart className="h-4 w-4 text-blue-500" />
    case "reservation_updated":
      return <Package className="h-4 w-4 text-yellow-500" />
    case "deposit_received":
      return <Check className="h-4 w-4 text-green-500" />
    case "user_registered":
      return <User className="h-4 w-4 text-purple-500" />
    case "low_stock":
      return <AlertTriangle className="h-4 w-4 text-red-500" />
    case "delegation_update":
      return <Wrench className="h-4 w-4 text-indigo-500" />
    case "repair_ready":
      return <CheckCheck className="h-4 w-4 text-green-500" />
    case "marketplace_request":
      return <Store className="h-4 w-4 text-amber-500" />
    case "sensitive_alert":
      return <ShieldAlert className="h-4 w-4 text-red-500" />
    case "reservation_expired":
    case "reservation_expiring_soon":
      return <Clock className="h-4 w-4 text-orange-500" />
    default:
      return <Bell className="h-4 w-4" />
  }
}

function formatTime(timestamp: string) {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return "Ahora"
  if (diffMins < 60) return `Hace ${diffMins}m`
  if (diffHours < 24) return `Hace ${diffHours}h`
  return `Hace ${diffDays}d`
}

function NotificationItem({
  notification,
  onOpen,
}: {
  notification: Notification
  onOpen: (notification: Notification) => void
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 p-3 border-b last:border-0 hover:bg-muted/50 transition-colors cursor-pointer",
        !notification.read && "bg-blue-50 dark:bg-blue-950/20"
      )}
      onClick={() => onOpen(notification)}
    >
      <div className="flex-shrink-0 mt-0.5">
        {getNotificationIcon(notification.type)}
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm font-medium", !notification.read && "font-semibold")}>
          {notification.title}
        </p>
        <p className="text-xs text-muted-foreground line-clamp-2">
          {notification.message}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {formatTime(notification.timestamp)}
        </p>
      </div>
      {!notification.read && (
        <div className="h-2 w-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" />
      )}
    </div>
  )
}

export function NotificationsDropdown() {
  const [isOpen, setIsOpen] = useState(false)
  const router = useRouter()
  const {
    notifications,
    isConnected,
    unreadCount,
    markAsRead,
    markAllAsRead,
    clearNotifications,
  } = useNotifications({
    onNotification: (notification) => {
      // Opcional: mostrar toast o sonido
      console.log("Nueva notificación:", notification)
    },
  })

  // Click = marcar leída + navegar al módulo relacionado cuando aplica.
  const openNotification = (notification: Notification) => {
    markAsRead(notification.id)
    const href = notificationHref(notification)
    if (href) {
      setIsOpen(false)
      router.push(href)
    }
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center font-medium">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
        {/* Indicador de conexión */}
        <span
          className={cn(
            "absolute bottom-0 right-0 h-2 w-2 rounded-full border border-background",
            isConnected ? "bg-green-500" : "bg-red-500"
          )}
        />
      </Button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown */}
          <div className="absolute right-0 sm:right-0 mt-2 w-[calc(100vw-2rem)] sm:w-80 max-w-sm bg-background border rounded-lg shadow-lg z-50 overflow-hidden left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b bg-muted/30">
              <h3 className="font-semibold">Notificaciones</h3>
              <div className="flex items-center gap-1">
                {notifications.length > 0 && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={markAllAsRead}
                      title="Marcar todas como leídas"
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={clearNotifications}
                      title="Limpiar todas"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Lista de notificaciones */}
            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No hay notificaciones</p>
                </div>
              ) : (
                notifications.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    onOpen={openNotification}
                  />
                ))
              )}
            </div>

            {/* Footer */}
            <div className="p-2 border-t bg-muted/30 text-center">
              <span
                className={cn(
                  "text-xs",
                  isConnected ? "text-green-600" : "text-red-600"
                )}
              >
                {isConnected ? "● Conectado" : "○ Desconectado"}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
