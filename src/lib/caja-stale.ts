import type { PrismaClient } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"

/**
 * Cajas llevas >48 h abiertas: casi siempre es un cierre olvidado (el
 * operador se fue sin cortar) y mientras siga OPEN la sucursal no puede
 * abrir su caja del día — la única por sucursal.
 *
 * Se dispara fire-and-forget desde GET /api/caja (`void ...catch()`): el
 * barrido nunca se awaita ni puede tumbar la respuesta. Un fallo del insert
 * de dedup solo puede re-notificar mañana — mejor que el silencio.
 *
 * Dedup igual que los turnos largos (src/bot/commands/long-shift-alerts):
 * Notification del tenant con type "stale_register" y data.registerId; a lo
 * sumo UNA por día por caja (createdAt >= inicio del día en UTC). Sin cajas
 * viejas no se consulta ni se crea nada.
 */

export const STALE_REGISTER_NOTIFICATION_TYPE = "stale_register"
const STALE_MS = 48 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export type StaleRegisterDb = Pick<PrismaClient, "cashRegister" | "notification">

export type StaleCheckResult = { scanned: number; notified: number; deduped: number }

export async function checkStaleRegisters(
  businessId: string,
  db: StaleRegisterDb = prisma,
  now: Date = new Date(),
): Promise<StaleCheckResult> {
  const result: StaleCheckResult = { scanned: 0, notified: 0, deduped: 0 }
  const stale = await db.cashRegister.findMany({
    where: {
      businessId,
      status: "OPEN",
      openedAt: { lt: new Date(now.getTime() - STALE_MS) },
    },
    select: {
      id: true,
      openedAt: true,
      branch: { select: { name: true } },
    },
  })
  result.scanned = stale.length
  if (stale.length === 0) return result

  // Inicio del día vigente: un segundo barrido hoy no vuelve a notificar;
  // el de mañana sí (la caja sigue abierta — el olvido continúa).
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  for (const register of stale) {
    try {
      const already = await db.notification.findFirst({
        where: {
          businessId,
          type: STALE_REGISTER_NOTIFICATION_TYPE,
          createdAt: { gte: dayStart },
          data: { path: ["registerId"], equals: register.id },
        },
        select: { id: true },
      })
      if (already) {
        result.deduped++
        continue
      }
      const days = Math.max(2, Math.floor((now.getTime() - register.openedAt.getTime()) / DAY_MS))
      const sucursal = register.branch?.name ?? "sucursal sin asignar"
      await db.notification.create({
        data: {
          businessId,
          type: STALE_REGISTER_NOTIFICATION_TYPE,
          // STAFF: la ven el EMPLOYEE que la dejó abierta y los ADMIN del
          // negocio en la campana (audience "ADMIN" la escondería del
          // responsable del olvido).
          audience: "STAFF",
          title: "Caja sin cerrar",
          message: `La caja de ${sucursal} lleva ${days} días abierta — ¿olvidaste cerrarla?`,
          data: { registerId: register.id, openedAt: register.openedAt.toISOString() },
        },
      })
      result.notified++
    } catch (e) {
      // Una caja no detiene a las demás; el error se anota y la próxima
      // pasada reintenta (el costo posible es una notificación duplicada
      // mañana si el create falló tras pasar la dedup).
      console.warn(`[caja-stale] No se pudo alertar la caja ${register.id}:`, e)
    }
  }
  return result
}
