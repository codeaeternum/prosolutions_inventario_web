import type { Telegraf, Types } from "telegraf"
import { getPrisma } from "./prisma"
import { errorText } from "./format"
import { retryOnTelegramLimit, TELEGRAM_API_TIMEOUT_MS, withTimeout } from "./utils"

/**
 * Indica si el usuario con el telegramId dado es ADMIN en la base de datos.
 */
export async function isAdmin(telegramId: string): Promise<boolean> {
  const prisma = getPrisma()
  if (!prisma) return false
  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: { role: true, status: true, business: { select: { isActive: true } } },
  })
  if (user?.business && !user.business.isActive) return false
  return user?.role === "ADMIN" && user.status === "APPROVED"
}

/**
 * Envía un mensaje HTML a los usuarios con rol ADMIN y telegramId definido
 * DEL NEGOCIO `businessId`. Multi-tenant: cada User.businessId es su empresa,
 * así que jamás se notifica a admins de otros tenants.
 * Usado para notificaciones internas (nuevos registros, reservas, etc.).
 */
export async function notifyAdmins(bot: Pick<Telegraf, "telegram">, businessId: string, message: string, extraOptions?: Types.ExtraReplyMessage): Promise<void> {
  const prisma = getPrisma()
  if (!prisma) return
  const isDev = process.env.NODE_ENV !== "production"
  try {
    const admins = await prisma.user.findMany({
      // Negocio activo solamente (patrón de daily-summary): los admins de un
      // tenant suspendido no reciben alertas — su cuenta además no opera.
      where: { businessId, role: "ADMIN", status: "APPROVED", telegramId: { not: null }, business: { isActive: true } },
    })
    if (isDev) console.log(`[Notify] Found ${admins.length} admins to notify.`)
    for (const admin of admins) {
      try {
        if (admin.telegramId) {
          // Variable local: el narrowing de telegramId no cruza el cierre de la arrow fn.
          const chatId = admin.telegramId
          // retryOnTelegramLimit: un 429 con retry_after duerme (cap 60 s) y
          // reintenta UNA vez; con timeout para que un socket colgado no
          // congele el aviso a los demás admins.
          await retryOnTelegramLimit(() => withTimeout(
            bot.telegram.sendMessage(chatId, message, { parse_mode: "HTML", ...extraOptions }),
            TELEGRAM_API_TIMEOUT_MS,
            "sendMessage a admin",
          ))
          if (isDev) console.log(`[Notify] Message sent to admin ${admin.name}`)
        }
      } catch (e: unknown) {
        // Sin nombre/telegramId ni el TelegrafError crudo (su `on` lleva el
        // payload con el texto enviado): el userId identifica al admin.
        console.error(`[Notify] Failed to send to admin ${admin.id}:`, errorText(e))
      }
    }
  } catch (e) {
    console.error("Error in notifyAdmins:", errorText(e))
  }
}
