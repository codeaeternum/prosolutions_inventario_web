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
//
// La fila del usuario se cachea 10 s por userId: el heartbeat (30 s) y cada
// broadcast preguntaban lo mismo a la BD. Se cachea la FILA y no el veredicto
// porque cada conexión compara su propio snapshot (dos pestañas del mismo
// usuario pueden tener passwords de épocas distintas). Revocar un acceso
// tarda ≤10 s en cortar el stream — gracia aceptada por diseño.
const AUTH_CACHE_TTL_MS = 10_000
type AuthUserRow = {
  status: string; password: string | null; businessId: string; role: string
  allowedModules: string[] | null; business: { isActive: boolean } | null
}
const authCache = new Map<string, { user: AuthUserRow | null; expiresAt: number }>()

/** Limpia la caché de revalidación. Solo para tests: es estado del módulo
 *  (como `connections`) y sobreviviría entre casos del mismo archivo. */
export function resetAuthCacheForTests() {
  authCache.clear()
}

async function stillAuthorized(connection: Connection): Promise<boolean> {
  const now = Date.now()
  const cached = authCache.get(connection.userId)
  let user = cached && cached.expiresAt > now ? cached.user : undefined
  if (user === undefined) {
    user = await prisma.user.findUnique({
      where: { id: connection.userId },
      select: { status: true, password: true, businessId: true, role: true, allowedModules: true, business: { select: { isActive: true } } },
    })
    // Barrido perezoso: el mapa crece con usuarios que ya se fueron; purgar
    // los expirados cuando crece evita retener basura indefinidamente.
    if (authCache.size > 500) {
      for (const [key, entry] of authCache) if (entry.expiresAt <= now) authCache.delete(key)
    }
    authCache.set(connection.userId, { user, expiresAt: now + AUTH_CACHE_TTL_MS })
  }
  return user?.status === "APPROVED"
    && user.password === connection.password
    && user.businessId === connection.businessId
    && user.role === connection.role
    && sameModules(user.allowedModules ?? [], connection.allowedModules)
    && (user.business?.isActive ?? false)
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
  "long_shift",
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

// Claves de `data` que se depuran (PII/secretos) tanto al persistir en BD
// como al emitir el frame SSE en vivo.
const SENSITIVE_DATA_KEYS = /email|phone|token|secret|password|pin|signature/i

function sanitizedData(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data) return undefined
  const clean = Object.fromEntries(Object.entries(data).filter(([key]) => !SENSITIVE_DATA_KEYS.test(key)))
  return Object.keys(clean).length ? clean : undefined
}

// Cada evento pertenece a UNA empresa: solo llega al staff conectado de ese negocio.
async function broadcast(notification: Omit<NotificationPayload, "id" | "timestamp">, roles: Set<string>, businessId: string) {
  const cleanData = sanitizedData(notification.data)
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
        data: cleanData as Prisma.InputJsonValue | undefined,
      },
      select: { id: true },
    })
    id = row.id
  } catch (error) {
    console.error("[notifications] persistencia falló; el broadcast en vivo sigue:", error)
  }
  const payload: NotificationPayload = { ...notification, data: cleanData, id, timestamp: new Date().toISOString() }
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
