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
  | "encargo_listo"
  | "delegation_update"
  | "sensitive_alert"
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
// Marca de "limpiar historial": oculta del merge lo que el servidor devuelva
// con timestamp <= a ella (el clear no borra filas en BD, solo la vista).
const CLEARED_KEY = "prosolutions_notifications_cleared_at"
const NOTIFICATION_SOUND = "/sounds/notification.mp3"
const MAX_NOTIFICATIONS = 50

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
    case "encargo_listo":
      return "/admin/inventario?tab=encargos"
    case "sensitive_alert":
      return "/admin/actividad"
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
    const toStore = notifications.slice(0, MAX_NOTIFICATIONS)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore))
  } catch {
    // Ignore storage errors
  }
}

function loadClearedAt(): string | null {
  if (typeof window === "undefined") return null
  try {
    return localStorage.getItem(CLEARED_KEY)
  } catch {
    return null
  }
}

// Dedupe: id de la fila persistida cuando existe; type+timestamp cubre los
// eventos que el servidor emitió sin persistir (BD caída) o el caché local.
function rememberNotification(seen: Set<string>, n: Notification) {
  seen.add(`id:${n.id}`)
  seen.add(`sig:${n.type}|${n.timestamp}`)
  if (seen.size > 1000) seen.clear() // memoria acotada: la lista visible es de 50
}

function wasSeen(seen: Set<string>, n: { id?: unknown; type?: unknown; timestamp?: unknown }): boolean {
  const byId = typeof n.id === "string" && seen.has(`id:${n.id}`)
  const bySig = typeof n.type === "string" && typeof n.timestamp === "string" && seen.has(`sig:${n.type}|${n.timestamp}`)
  return byId || bySig
}

// POST /api/notifications/read — devuelve el unreadCount del servidor o null
// si la llamada falló (offline/endpoint caído): el estado local ya quedó.
async function postRead(body: { ids?: string[]; all?: boolean }): Promise<number | null> {
  try {
    const res = await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) return null
    const json = await res.json()
    return typeof json?.unreadCount === "number" ? json.unreadCount : null
  } catch {
    return null
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

  const playSoundRef = useRef(playSound)
  const persistRef = useRef(persist)
  const onNotificationRef = useRef(onNotification)
  // Espejo de `notifications` para leer la lista vigente desde callbacks
  // async (hidratación) sin depender del timing del updater de React.
  const listRef = useRef<Notification[]>([])
  // Ids/firmas ya vistos: dedupe entre historial del servidor y eventos SSE.
  const seenRef = useRef<Set<string>>(new Set())

  // Único punto de mutación de la lista: mantiene state + ref + caché local.
  const applyList = useCallback((updater: (prev: Notification[]) => Notification[]) => {
    const next = updater(listRef.current)
    listRef.current = next
    setNotifications(next)
    if (persistRef.current) {
      persistNotifications(next)
    }
    return next
  }, [])

  // Hidrata el historial: el SERVIDOR es la fuente de verdad; localStorage
  // queda como caché offline. Corre al montar y en cada reconexión. Va en
  // microtask: setState síncrono en el effect dispararía renders en cascada
  // (react-hooks/set-state-in-effect) y en useState() rompería la hidratación.
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    queueMicrotask(async () => {
      const local = persist ? loadPersistedNotifications() : []
      let remote: Notification[] | null = null
      let serverUnread: number | null = null
      try {
        const res = await fetch("/api/notifications", { cache: "no-store" })
        if (res.ok) {
          const body = await res.json()
          if (Array.isArray(body?.notifications)) remote = body.notifications as Notification[]
          if (typeof body?.unreadCount === "number") serverUnread = body.unreadCount
        }
      } catch {
        // Sin red o endpoint caído: queda solo el caché local.
      }
      if (cancelled) return
      const clearedAt = loadClearedAt()
      const merged = applyList((prev) => {
        const seen = new Set<string>()
        const out: Notification[] = []
        for (const n of [...(remote ?? []), ...prev, ...local]) {
          if (typeof n?.id !== "string" || typeof n?.timestamp !== "string") continue
          if (clearedAt && n.timestamp <= clearedAt) continue
          if (wasSeen(seen, n)) continue
          rememberNotification(seen, n)
          out.push(n)
        }
        out.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
        const trimmed = out.slice(0, MAX_NOTIFICATIONS)
        // El dedupe de SSE se resincroniza con lo que quedó visible.
        seenRef.current = seen
        return trimmed
      })
      setUnreadCount(Math.max(serverUnread ?? 0, merged.filter((n) => !n.read).length))
    })
    return () => { cancelled = true }
  }, [enabled, persist, generation, applyList])

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

          // Ya la tenemos (del historial o de un evento SSE repetido): el id
          // del servidor es la clave; type+timestamp cubre eventos sin id.
          if (wasSeen(seenRef.current, data)) return

          const notification: Notification = {
            id: typeof data.id === "string" ? data.id : crypto.randomUUID(),
            type: data.type,
            title: data.title || "Notificación",
            message: data.message,
            data: data.data,
            timestamp: data.timestamp,
            read: false,
          }
          rememberNotification(seenRef.current, notification)

          applyList((prev) => [notification, ...prev].slice(0, MAX_NOTIFICATIONS))
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
  }, [enabled, generation, applyList])

  // Marca leída en servidor y corrige el contador con el unreadCount real
  // (puede haber no leídas fuera de la ventana de 50 que el hook no lista).
  const markAsRead = useCallback((notificationId: string) => {
    applyList((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
    )
    setUnreadCount((prev) => Math.max(0, prev - 1))
    void postRead({ ids: [notificationId] }).then((serverUnread) => {
      if (typeof serverUnread === "number") setUnreadCount(serverUnread)
    })
  }, [applyList])

  const markAllAsRead = useCallback(() => {
    applyList((prev) => prev.map((n) => ({ ...n, read: true })))
    setUnreadCount(0)
    void postRead({ all: true }).then((serverUnread) => {
      if (typeof serverUnread === "number") setUnreadCount(serverUnread)
    })
  }, [applyList])

  // Limpieza local: oculta la lista y recuerda el corte para que el historial
  // del servidor no las reviva en la próxima hidratación. Además marca todo
  // como leído en servidor (best-effort) para apagar el contador.
  const clearNotifications = useCallback(() => {
    applyList(() => [])
    setUnreadCount(0)
    if (persistRef.current) {
      try {
        localStorage.removeItem(STORAGE_KEY)
        localStorage.setItem(CLEARED_KEY, new Date().toISOString())
      } catch {
        // Ignore storage errors
      }
    }
    void postRead({ all: true })
  }, [applyList])

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
