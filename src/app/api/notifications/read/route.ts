import { NextRequest, NextResponse } from "next/server"
import { assertModuleAllowed, requireAdminOrEmployee, getSession } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"

const MAX_IDS = 200

// Marca leídas las notificaciones del usuario. Solo toca filas del propio
// negocio y de la audiencia visible (EMPLOYEE jamás marca una "ADMIN"):
// los ids del body se re-filtran contra la BD, nunca se confía en ellos.
// Body: { ids?: string[] } o { all: true }.
export async function POST(req: NextRequest) {
  const result = await requireAdminOrEmployee()
  if (result.error) return result.error

  const session = getSession(result)!
  // Marcar leídas toca el mismo feed que el historial y el stream: exige el
  // módulo notificaciones (sin él un empleado podía mutar su estado de lectura).
  const denied = assertModuleAllowed(session, "notificaciones")
  if (denied) return denied
  const businessId = businessIdOf(session)
  const userId = session.user.id
  const visible = session.user.role === "EMPLOYEE" ? { audience: "STAFF" } : {}

  const body = (await req.json().catch(() => null)) as { ids?: unknown; all?: unknown } | null
  const all = body?.all === true
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((id): id is string => typeof id === "string").slice(0, MAX_IDS)
    : []
  if (!all && ids.length === 0) {
    return NextResponse.json({ error: "Se requiere ids o all: true" }, { status: 400 })
  }

  const targets = await prisma.notification.findMany({
    where: {
      businessId,
      ...visible,
      ...(all ? {} : { id: { in: ids } }),
      reads: { none: { userId } },
    },
    select: { id: true },
  })

  if (targets.length > 0) {
    await prisma.notificationRead.createMany({
      data: targets.map((t) => ({ notificationId: t.id, userId })),
      skipDuplicates: true,
    })
  }

  const unreadCount = await prisma.notification.count({
    where: { businessId, ...visible, reads: { none: { userId } } },
  })
  return NextResponse.json({ ok: true, unreadCount })
}
