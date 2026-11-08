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
    // allowedModules/allowedBranchIds alimentan hasModule/hasBranchAccess
    // (lib/access): el staff restringido por módulo o sucursal conserva la
    // misma regla que en la web. homeBranchId lo usa /stock para resolver la
    // sucursal del ajuste.
    select: { id: true, businessId: true, role: true, status: true, name: true, allowedModules: true, allowedBranchIds: true, homeBranchId: true },
  })
}

/**
 * requireAdmin + getBotAccount en un solo findUnique, para comandos de texto.
 * Devuelve la cuenta del admin o null tras responder:
 * - sin prisma        → "No disponible temporalmente" (igual que requirePrisma)
 * - sin cuenta        → "Cuenta no disponible."
 * - sin rol/aprobación → mensaje de solo-admin (igual que requireAdmin)
 */
export async function requireAdminAccount(ctx: Context, prisma: PrismaClient | null | undefined) {
  if (ctx.chat?.type !== "private") return null
  const telegramId = ctx.from?.id?.toString()
  if (!telegramId) return null
  if (!prisma) {
    await ctx.reply(MSG_UNAVAILABLE)
    return null
  }
  const account = await getBotAccount(prisma, telegramId)
  if (!account) {
    await ctx.reply("Cuenta no disponible.")
    return null
  }
  if (account.role !== "ADMIN" || account.status !== "APPROVED") {
    await ctx.reply(MSG_ADMIN_ONLY)
    return null
  }
  return account
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
