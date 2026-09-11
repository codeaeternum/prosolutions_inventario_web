import type { Context } from "telegraf"
import { isAdmin } from "./notify"
import { getPrisma } from "./prisma"

const MSG_ADMIN_ONLY = "🚫 Este comando es solo para administradores."
const MSG_UNAVAILABLE = "⚠️ No disponible temporalmente."

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
