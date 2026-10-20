import { NextRequest } from "next/server"
import { Prisma } from "@prisma/client"
import { assertModuleAllowed, requireAdminOrEmployee, getSession } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"

// Conexiones activas indexadas por negocio: un broadcast solo recorre las del
// tenant destinatario en vez de barrer todas las sesiones SSE del proceso.
type Connection = { controller: ReadableStreamDefaultController; userId: string; role: string; allowedModules: string[]; businessId: string; password: string | null; close: () => void }
const connections = new Map<string, Set<Connection>>() // businessId → conexiones

/** Los módulos se comparan como conjunto: el orden de la lista no es identidad. */
const sameModules = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(m => b.includes(m))

// Revalida la sesión en cada heartbeat/broadcast: la conexión muere si el
// usuario cambia de estado/password/empresa O si la empresa se suspende
// (Business.isActive=false corta también los streams ya abiertos). También
// muere si cambian el rol o los módulos respecto al snapshot del conectar —
// el broadcast filtra por ese snapshot, así que un empleado degradado o sin
// "notificaciones" ya no seguiría recibiendo el feed con privilegio viejo.
async function stillAuthorized(connection: Connection): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: connection.userId },
    select: { status: true, password: true, businessId: true, role: true, allowedModules: true, business: { select: { isActive: true } } },
  })
  return user?.status === "APPROVED"
    && user.password === connection.password
    && user.businessId === connection.businessId
    && user.role === connection.role
    && sameModules(user.allowedModules ?? [], connection.allowedModules)
    && user.business.isActive
}

// Tipos de eventos (fuente única: el POST de /send los valida con este enum)
export const NOTIFICATION_TYPES = [
  "new_reservation",
  "reservation_updated",
  "reservation_expired",
  "reservation_expiring_soon",
  "deposit_received",
  "user_registered",
  "low_stock",
  "repair_ready",
  "marketplace_request",
  "encargo_listo",
  "delegation_update",
  "sensitive_alert",
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export interface NotificationPayload {
  // id de la fila persistida; los clientes lo usan para dedupe contra el
  // historial de GET /api/notifications. Ausente si la persistencia falló.
  id?: string
  type: NotificationType
  title: string
  message: string
  data?: Record<string, unknown>
  timestamp: string
}

// Claves de `data` que no se persisten (PII/secretos). El payload SSE en vivo
// conserva todo — la depuración solo aplica a la copia en BD.
const SENSITIVE_DATA_KEYS = /email|phone|token|secret|password|pin|signature/i

function sanitizedData(data?: Record<string, unknown>): Prisma.InputJsonValue | undefined {
  if (!data) return undefined
  const clean = Object.fromEntries(Object.entries(data).filter(([key]) => !SENSITIVE_DATA_KEYS.test(key)))
  return (Object.keys(clean).length ? clean : undefined) as Prisma.InputJsonValue | undefined
}

// Cada evento pertenece a UNA empresa: solo llega al staff conectado de ese negocio.
async function broadcast(notification: Omit<NotificationPayload, "id" | "timestamp">, roles: Set<string>, businessId: string) {
  // Persistir ANTES de emitir: el historial del staff vive en BD y el SSE
  // lleva el id de la fila. Un fallo de BD solo se loguea — el broadcast
  // en vivo sigue funcionando como antes (payload sin id).
  let id: string | undefined
  try {
    const row = await prisma.notification.create({
      data: {
        businessId,
        type: notification.type,
        // Replica el Set de roles del broadcast: {ADMIN} → "ADMIN",
        // {ADMIN,EMPLOYEE} → "STAFF".
        audience: roles.has("EMPLOYEE") ? "STAFF" : "ADMIN",
        title: notification.title,
        message: notification.message,
        data: sanitizedData(notification.data),
      },
      select: { id: true },
    })
    id = row.id
  } catch (error) {
    console.error("[notifications] persistencia falló; el broadcast en vivo sigue:", error)
  }
  const payload: NotificationPayload = { ...notification, id, timestamp: new Date().toISOString() }
  const bytes = new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`)
  // Solo las conexiones del tenant objetivo y del rol destinatario reciben el
  // evento. Las demás NO se cierran (antes cualquier broadcast desconectaba a
  // todos los no-destinatarios) ni pagan la revalidación de BD — su propio
  // heartbeat las revalida cada 30 s.
  await Promise.all([...(connections.get(businessId) ?? [])].map(async connection => {
    try {
      if (!roles.has(connection.role)) return
      if (!await stillAuthorized(connection)) { connection.close(); return }
      connection.controller.enqueue(bytes)
    } catch { connection.close() }
  }))
}

// Eventos administrativos: solo admins conectados de la empresa indicada
export async function sendNotificationToAdmins(notification: Omit<NotificationPayload, "id" | "timestamp">, businessId: string) {
  return broadcast(notification, new Set(["ADMIN"]), businessId)
}

// Eventos operativos: todo el staff (admin + empleados) de la empresa indicada
export async function sendNotificationToStaff(notification: Omit<NotificationPayload, "id" | "timestamp">, businessId: string) {
  return broadcast(notification, new Set(["ADMIN", "EMPLOYEE"]), businessId)
}

export async function GET(req: NextRequest) {
  const result = await requireAdminOrEmployee()
  if (result.error) return result.error

  const session = getSession(result)!
  // El stream lleva el feed completo en vivo (data sin depurar): mismo gate
  // que el historial — el módulo notificaciones.
  const denied = assertModuleAllowed(session, "notificaciones")
  if (denied) return denied
  const userId = session.user.id
  const businessId = businessIdOf(session)
  const current = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, status: true, password: true, allowedModules: true } })
  if (!current || (current.role !== "ADMIN" && current.role !== "EMPLOYEE") || current.status !== "APPROVED") return new Response(null, { status: 403 })
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let controllerRef: ReadableStreamDefaultController | undefined
  let connectionRef: Connection | undefined
  const close = () => {
    if (heartbeat) clearInterval(heartbeat)
    if (connectionRef) {
      const set = connections.get(connectionRef.businessId)
      if (set) {
        set.delete(connectionRef)
        if (set.size === 0) connections.delete(connectionRef.businessId)
      }
      connectionRef = undefined
    }
    req.signal.removeEventListener("abort", close)
    try { controllerRef?.close() } catch { /* Already closed. */ }
  }
  const stream = new ReadableStream({
    start(controller) {
      controllerRef = controller
      const connection: Connection = { controller, userId, role: current.role, allowedModules: current.allowedModules ?? [], businessId, password: current.password, close }
      connectionRef = connection
      let set = connections.get(businessId)
      if (!set) connections.set(businessId, (set = new Set()))
      set.add(connection)
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: "connected", timestamp: new Date().toISOString() })}\n\n`))
      heartbeat = setInterval(async () => {
        try {
          if (!await stillAuthorized(connection)) { close(); return }
          controller.enqueue(new TextEncoder().encode(": heartbeat\n\n"))
        } catch { close() }
      }, 30000)
      req.signal.addEventListener("abort", close)
      if (req.signal.aborted) close()
    },
    cancel: close,
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "private, no-store, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
