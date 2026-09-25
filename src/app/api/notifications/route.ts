import { NextResponse } from "next/server"
import { requireAdminOrEmployee, getSession } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"

const HISTORY_LIMIT = 50

// Historial persistente de notificaciones del staff: la fuente de verdad que
// reemplaza al localStorage efímero. El filtro de audiencia replica el
// broadcast SSE: ADMIN ve todo (ADMIN + STAFF), EMPLOYEE solo "STAFF".
// `read` es por usuario (NotificationRead) y unreadCount cuenta todas las
// visibles sin leer, no solo la página devuelta.
export async function GET() {
  const result = await requireAdminOrEmployee()
  if (result.error) return result.error

  const session = getSession(result)!
  const businessId = businessIdOf(session)
  const userId = session.user.id
  const visible = session.user.role === "EMPLOYEE" ? { audience: "STAFF" } : {}

  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { businessId, ...visible },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        data: true,
        createdAt: true,
        reads: { where: { userId }, select: { notificationId: true } },
      },
    }),
    prisma.notification.count({
      where: { businessId, ...visible, reads: { none: { userId } } },
    }),
  ])

  return NextResponse.json(
    {
      notifications: rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        data: n.data ?? undefined,
        timestamp: n.createdAt.toISOString(),
        read: n.reads.length > 0,
      })),
      unreadCount,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  )
}
