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
  const [isConnected, setIsConnected] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  // Load persisted data on mount
  useEffect(() => {
    if (persist) {
      const persisted = loadPersistedNotifications()
      setNotifications(persisted)
      setUnreadCount(persisted.filter(n => !n.read).length)
    }
  }, [persist])
  const playSoundRef = useRef(playSound)
  const persistRef = useRef(persist)
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const maxReconnectAttempts = 5
  const onNotificationRef = useRef(onNotification)

  // Actualizar ref cuando cambia onNotification
  useEffect(() => {
    onNotificationRef.current = onNotification
  }, [onNotification])

  const connect = useCallback(() => {
    // Evitar reconexiones excesivas
    if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
      console.log("SSE: Máximo de intentos de reconexión alcanzado")
      return
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    const eventSource = new EventSource("/api/notifications/stream")
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      setIsConnected(true)
      reconnectAttemptsRef.current = 0 // Reset intentos al conectar
      console.log("SSE: Conectado a notificaciones")
    }

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        // Si recibimos error de autenticación, no reconectar
        if (data.type === "error" && data.code === "UNAUTHORIZED") {
          console.log("SSE: No autorizado, desconectando")
          eventSource.close()
          setIsConnected(false)
          return
        }

        if (data.type === "connected") {
          setIsConnected(true)
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
      setIsConnected(false)
      eventSource.close()
      reconnectAttemptsRef.current += 1

      // Reconectar con backoff exponencial
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        const delay = Math.min(5000 * Math.pow(2, reconnectAttemptsRef.current - 1), 30000)
        console.log(`SSE: Reconectando en ${delay / 1000}s (intento ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`)

        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          connect()
        }, delay)
      }
    }
  }, [])

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }
    reconnectAttemptsRef.current = 0
    setIsConnected(false)
  }, [])

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

  const resetAndReconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0
    connect()
  }, [connect])

  useEffect(() => {
    if (enabled) {
      connect()
    } else {
      disconnect()
    }

    return () => {
      disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  return {
    notifications,
    isConnected,
    unreadCount,
    markAsRead,
    markAllAsRead,
    clearNotifications,
    reconnect: resetAndReconnect,
  }
}
