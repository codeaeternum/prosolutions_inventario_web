import { NextRequest } from "next/server"
import { requireAdminOrEmployee, getSession } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"

// Almacenar conexiones activas
type Connection = { controller: ReadableStreamDefaultController; userId: string; role: string; businessId: string; password: string | null; close: () => void }
const connections = new Map<string, Connection>()

async function stillAuthorized(connection: Connection): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: connection.userId }, select: { status: true, password: true, businessId: true } })
  return user?.status === "APPROVED" && user.password === connection.password && user.businessId === connection.businessId
}

// Tipos de eventos
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

export interface NotificationPayload {
  type: NotificationType
  title: string
  message: string
  data?: Record<string, unknown>
  timestamp: string
}

// Cada evento pertenece a UNA empresa: solo llega al staff conectado de ese negocio.
async function broadcast(notification: Omit<NotificationPayload, "timestamp">, roles: Set<string>, businessId: string) {
  const payload: NotificationPayload = { ...notification, timestamp: new Date().toISOString() }
  const bytes = new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`)
  await Promise.all([...connections.values()].map(async connection => {
    try {
      if (connection.businessId !== businessId || !roles.has(connection.role) || !await stillAuthorized(connection)) { connection.close(); return }
      connection.controller.enqueue(bytes)
    } catch { connection.close() }
  }))
}

// Eventos administrativos: solo admins conectados de la empresa indicada
export async function sendNotificationToAdmins(notification: Omit<NotificationPayload, "timestamp">, businessId: string) {
  return broadcast(notification, new Set(["ADMIN"]), businessId)
}

// Eventos operativos: todo el staff (admin + empleados) de la empresa indicada
export async function sendNotificationToStaff(notification: Omit<NotificationPayload, "timestamp">, businessId: string) {
  return broadcast(notification, new Set(["ADMIN", "EMPLOYEE"]), businessId)
}

export async function GET(req: NextRequest) {
  const result = await requireAdminOrEmployee()
  if (result.error) return result.error

  const session = getSession(result)!
  const userId = session.user.id
  const businessId = businessIdOf(session)
  const current = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, status: true, password: true } })
  if (!current || (current.role !== "ADMIN" && current.role !== "EMPLOYEE") || current.status !== "APPROVED") return new Response(null, { status: 403 })
  const connectionId = crypto.randomUUID()
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let controllerRef: ReadableStreamDefaultController | undefined
  const close = () => {
    if (heartbeat) clearInterval(heartbeat)
    connections.delete(connectionId)
    req.signal.removeEventListener("abort", close)
    try { controllerRef?.close() } catch { /* Already closed. */ }
  }
  const stream = new ReadableStream({
    start(controller) {
      controllerRef = controller
      const connection = { controller, userId, role: current.role, businessId, password: current.password, close }
      connections.set(connectionId, connection)
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
