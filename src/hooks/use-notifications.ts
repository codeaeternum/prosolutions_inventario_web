"use client"

import { useEffect, useRef, useState, useCallback } from "react"

export type NotificationType =
  | "new_reservation"
  | "reservation_updated"
  | "reservation_expired"
  | "reservation_expiring_soon"
  | "deposit_received"
  | "user_registered"
  | "low_stock"
  | "repair_ready"
  | "marketplace_request"
  | "delegation_update"
  | "connected"

export interface Notification {
  id: string
  type: NotificationType
  title: string
  message: string
  data?: Record<string, unknown>
  timestamp: string
  read: boolean
}

interface UseNotificationsOptions {
  onNotification?: (notification: Notification) => void
  enabled?: boolean
  playSound?: boolean
  persist?: boolean
}

const STORAGE_KEY = "prosolutions_notifications"
const NOTIFICATION_SOUND = "/sounds/notification.mp3"

/** Destino al hacer clic en una notificación (null = solo marca leída). */
export function notificationHref(notification: Notification): string | null {
  const orderId = typeof notification.data?.orderId === "string" ? notification.data.orderId : null
  switch (notification.type) {
    case "delegation_update":
    case "repair_ready":
      return orderId ? `/admin/taller?orden=${orderId}` : "/admin/taller"
    case "low_stock":
      return "/admin/inventario"
    case "new_reservation":
    case "reservation_updated":
    case "reservation_expired":
    case "reservation_expiring_soon":
    case "deposit_received":
      return "/admin/reservas"
    case "marketplace_request":
      return "/admin/mercado"
    default:
      return null
  }
}

function loadPersistedNotifications(): Notification[] {
  if (typeof window === "undefined") return []
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function persistNotifications(notifications: Notification[]) {
  if (typeof window === "undefined") return
  try {
    // Keep only last 50 notifications
    const toStore = notifications.slice(0, 50)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore))
  } catch {
    // Ignore storage errors
  }
}

function playNotificationSound() {
  try {
    const audio = new Audio(NOTIFICATION_SOUND)
    audio.volume = 0.5
    audio.play().catch(() => {
      // Ignore autoplay errors (browser policy)
    })
  } catch {
    // Ignore audio errors
  }
}

export function useNotifications(options: UseNotificationsOptions = {}) {
  const { onNotification, enabled = true, playSound = true, persist = true } = options
  // Initialize empty to avoid hydration mismatch
  const [notifications, setNotifications] = useState<Notification[]>([])
  // rawConnected refleja el socket; isConnected expuesto también respeta `enabled`.
  const [rawConnected, setRawConnected] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  // Bump de generación = reconectar desde cero (reconnect público).
  const [generation, setGeneration] = useState(0)

  // Load persisted data on mount. Va en microtask: cargarlo síncrono en el
  // effect dispararía renders en cascada (react-hooks/set-state-in-effect) y
  // en useState() inicial rompería la hidratación.
  useEffect(() => {
    if (!persist) return
    queueMicrotask(() => {
      const persisted = loadPersistedNotifications()
      setNotifications(persisted)
      setUnreadCount(persisted.filter(n => !n.read).length)
    })
  }, [persist])
  const playSoundRef = useRef(playSound)
  const persistRef = useRef(persist)
  const onNotificationRef = useRef(onNotification)

  // Actualizar ref cuando cambia onNotification
  useEffect(() => {
    onNotificationRef.current = onNotification
  }, [onNotification])

  // El ciclo de vida del EventSource vive completo dentro del effect: los
  // setState solo ocurren en callbacks de eventos (onopen/onmessage/onerror),
  // que es el patrón correcto para suscribirse a un sistema externo.
  useEffect(() => {
    if (!enabled) return

    const maxReconnectAttempts = 5
    let attempts = 0
    let eventSource: EventSource | null = null
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      // Evitar reconexiones excesivas
      if (attempts >= maxReconnectAttempts) {
        console.log("SSE: Máximo de intentos de reconexión alcanzado")
        return
      }

      eventSource?.close()
      eventSource = new EventSource("/api/notifications/stream")

      eventSource.onopen = () => {
        attempts = 0 // Reset intentos al conectar
        setRawConnected(true)
        console.log("SSE: Conectado a notificaciones")
      }

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)

          // Si recibimos error de autenticación, no reconectar
          if (data.type === "error" && data.code === "UNAUTHORIZED") {
            console.log("SSE: No autorizado, desconectando")
            attempts = maxReconnectAttempts
            eventSource?.close()
            setRawConnected(false)
            return
          }

          if (data.type === "connected") {
            setRawConnected(true)
            return
          }

          const notification: Notification = {
            id: crypto.randomUUID(),
            type: data.type,
            title: data.title || "Notificación",
            message: data.message,
            data: data.data,
            timestamp: data.timestamp,
            read: false,
          }

          setNotifications((prev) => {
            const updated = [notification, ...prev]
            if (persistRef.current) {
              persistNotifications(updated)
            }
            return updated
          })
          setUnreadCount((prev) => prev + 1)

          // Play sound for new notifications
          if (playSoundRef.current) {
            playNotificationSound()
          }

          onNotificationRef.current?.(notification)
        } catch (error) {
          console.error("SSE: Error parsing message", error)
        }
      }

      eventSource.onerror = () => {
        setRawConnected(false)
        eventSource?.close()
        attempts += 1

        // Reconectar con backoff exponencial
        if (attempts < maxReconnectAttempts) {
          const delay = Math.min(5000 * Math.pow(2, attempts - 1), 30000)
          console.log(`SSE: Reconectando en ${delay / 1000}s (intento ${attempts}/${maxReconnectAttempts})`)

          if (reconnectTimeout) {
            clearTimeout(reconnectTimeout)
          }
          reconnectTimeout = setTimeout(connect, delay)
        }
      }
    }

    connect()

    return () => {
      eventSource?.close()
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
    }
  }, [enabled, generation])

  const markAsRead = useCallback((notificationId: string) => {
    setNotifications((prev) => {
      const updated = prev.map((n) =>
        n.id === notificationId ? { ...n, read: true } : n
      )
      if (persistRef.current) {
        persistNotifications(updated)
      }
      return updated
    })
    setUnreadCount((prev) => Math.max(0, prev - 1))
  }, [])

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }))
      if (persistRef.current) {
        persistNotifications(updated)
      }
      return updated
    })
    setUnreadCount(0)
  }, [])

  const clearNotifications = useCallback(() => {
    setNotifications([])
    setUnreadCount(0)
    if (persistRef.current) {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  const reconnect = useCallback(() => {
    setGeneration(g => g + 1)
  }, [])

  return {
    notifications,
    isConnected: enabled && rawConnected,
    unreadCount,
    markAsRead,
    markAllAsRead,
    clearNotifications,
    reconnect,
  }
}
