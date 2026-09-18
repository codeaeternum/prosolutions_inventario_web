import type { Context } from "telegraf"
import type { PrismaClient } from "@prisma/client"
import { isAdmin } from "./notify"
import { getPrisma } from "./prisma"

const MSG_ADMIN_ONLY = "🚫 Este comando es solo para administradores."
const MSG_UNAVAILABLE = "⚠️ No disponible temporalmente."

/**
 * Resuelve la cuenta registrada del usuario de Telegram.
 * Multi-tenant: cada User.businessId es su empresa. Todo comando que lea o
 * escriba datos de negocio DEBE scopear sus queries por `businessId` de esta
 * cuenta (nunca por un id global ni por el negocio por defecto).
 */
export async function getBotAccount(prisma: PrismaClient, telegramId: string) {
  return prisma.user.findUnique({
    where: { telegramId },
    select: { id: true, businessId: true, role: true, status: true },
  })
}

/**
 * Comprueba que el usuario sea admin. Si no, envía mensaje y devuelve false.
 */
export async function requireAdmin(ctx: Context): Promise<boolean> {
  if (ctx.chat?.type !== "private") return false
  const telegramId = ctx.from?.id?.toString()
  if (!telegramId) return false
  if (!(await isAdmin(telegramId))) {
    await ctx.reply(MSG_ADMIN_ONLY)
    return false
  }
  return true
}

/**
 * Comprueba que Prisma (BD) esté disponible. Si no, envía mensaje y devuelve false.
 */
export async function requirePrisma(ctx: Context): Promise<boolean> {
  if (!getPrisma()) {
    await ctx.reply(MSG_UNAVAILABLE)
    return false
  }
  return true
}
