import type { Telegraf, Types } from "telegraf"
import { getPrisma } from "./prisma"

/**
 * Indica si el usuario con el telegramId dado es ADMIN en la base de datos.
 */
export async function isAdmin(telegramId: string): Promise<boolean> {
  const prisma = getPrisma()
  if (!prisma) return false
  const user = await prisma.user.findUnique({ where: { telegramId } })
  return user?.role === "ADMIN" && user.status === "APPROVED"
}

/**
 * Envía un mensaje HTML a los usuarios con rol ADMIN y telegramId definido
 * DEL NEGOCIO `businessId`. Multi-tenant: cada User.businessId es su empresa,
 * así que jamás se notifica a admins de otros tenants.
 * Usado para notificaciones internas (nuevos registros, reservas, etc.).
 */
export async function notifyAdmins(bot: Telegraf, businessId: string, message: string, extraOptions?: Types.ExtraReplyMessage): Promise<void> {
  const prisma = getPrisma()
  if (!prisma) return
  const isDev = process.env.NODE_ENV !== "production"
  try {
    const admins = await prisma.user.findMany({
      where: { businessId, role: "ADMIN", status: "APPROVED", telegramId: { not: null } },
    })
    if (isDev) console.log(`[Notify] Found ${admins.length} admins to notify.`)
    for (const admin of admins) {
      try {
        if (admin.telegramId) {
          await bot.telegram.sendMessage(admin.telegramId, message, { parse_mode: "HTML", ...extraOptions })
          if (isDev) console.log(`[Notify] Message sent to admin ${admin.name}`)
        }
      } catch (e: unknown) {
        console.error(`[Notify] Failed to send to admin ${admin.name} (${admin.telegramId}):`, e)
      }
    }
  } catch (e) {
    console.error("Error in notifyAdmins:", e)
  }
}
