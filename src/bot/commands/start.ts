import type { Context, Telegraf } from "telegraf"
import type { PrismaClient } from "@prisma/client"
import type { WizardState } from "../lib/types"
import { consumeVerificationCode, markVerified, VerificationError } from "../../lib/verification"
import { sendWelcomeEmail } from "../../lib/mailer"

export type { WizardState }

/**
 * Deep-link de verificación: /start verify_<6 dígitos>. El código viaja en el
 * link (canal TELEGRAM); aquí se consume, se marca phoneVerifiedAt y se liga
 * el telegramId a la cuenta que lo generó — nunca se le quita a otro usuario.
 */
async function handleVerifyPayload(ctx: Context, prisma: PrismaClient, telegramId: string, code: string) {
  try {
    const consumed = await consumeVerificationCode(prisma, { code, channel: "TELEGRAM" })

    if (!consumed.userId) {
      return ctx.reply("⚠️ Ese código no está ligado a ninguna cuenta. Genera uno nuevo desde /verificar.")
    }

    const target = await prisma.user.findUnique({
      where: { id: consumed.userId },
      select: { id: true, name: true, telegramId: true },
    })
    if (!target) {
      return ctx.reply("⚠️ La cuenta ligada a ese código ya no existe.")
    }

    // El telegramId es único global: si ya es de otro usuario no se mueve.
    const holder = await prisma.user.findUnique({
      where: { telegramId },
      select: { id: true, name: true },
    })
    const conflict = holder && holder.id !== target.id

    const verified = await markVerified(prisma, target.id, consumed.channel)
    // Dueño recién activado: correo de bienvenida sin bloquear el reply.
    if (verified.promotedOwner && verified.email) {
      void sendWelcomeEmail(verified.email, verified.businessName, verified.businessSlug)
        .catch((err) => console.error("[bot/start] Error enviando bienvenida:", err))
    }

    if (!conflict && !target.telegramId) {
      await prisma.user.update({ where: { id: target.id }, data: { telegramId } })
    }

    if (conflict) {
      return ctx.reply(
        `✅ Teléfono verificado para ${target.name}.\n\n` +
        `⚠️ Esta cuenta de Telegram ya está ligada a otro usuario, así que no la moví. ` +
        `Si es un error, contacta al administrador.`
      )
    }
    return ctx.reply(`✅ ¡Teléfono verificado, ${target.name}! Ya puedes recibir avisos por aquí.`)
  } catch (error) {
    if (error instanceof VerificationError) {
      if (error.reason === "EXPIRED") {
        return ctx.reply("⏰ Ese código ya expiró (duran 15 min). Genera uno nuevo desde la app en /verificar.")
      }
      if (error.reason === "TOO_MANY_ATTEMPTS") {
        return ctx.reply("🔒 Ese código se bloqueó por muchos intentos. Genera uno nuevo desde la app.")
      }
      return ctx.reply("❌ Código no válido o ya utilizado. Si necesitas uno nuevo, pídelo desde /verificar.")
    }
    console.error("[bot/start] Error verificando código:", error)
    return ctx.reply("⚠️ No pude verificar el código. Intenta de nuevo en unos minutos.")
  }
}

export function registerStart(
  bot: Telegraf,
  prisma: PrismaClient | null,
  registrationSessions: Record<string, WizardState>
) {
  bot.start(async (ctx) => {
    const telegramId = ctx.from.id.toString()

    // /start verify_<6 dígitos> — verificación de teléfono post-registro web.
    const payload = typeof ctx.payload === "string" ? ctx.payload : ""
    const verifyMatch = payload.match(/^verify_(\d{6})$/)
    if (verifyMatch && prisma) {
      return handleVerifyPayload(ctx, prisma, telegramId, verifyMatch[1])
    }

    if (prisma) {
      const user = await prisma.user.findUnique({ where: { telegramId } })
      if (user) {
        const adminBadge = user.role === "ADMIN" ? " 👑" : ""
        return ctx.reply(
          `👋 *Hola de nuevo ${user.name}!*${adminBadge}

✅ Sistema: ONLINE

🔍 *¿Qué buscas hoy?*
Escribe el nombre del producto, ej: "Pantalla iPhone 15"

O usa:
/perfil - Ver mis datos
/categorias - Ver catálogo
${user.role === "ADMIN" ? "/admin - Panel de administración\n" : ""}/ayuda - Ver más opciones`,
          { parse_mode: "Markdown" }
        )
      }
    }

    registrationSessions[telegramId] = { step: "NAME", data: { telegramId } }
    await ctx.reply(
      `👋 *¡Bienvenido a ProSolutions!*

Para atenderte y darte los mejores precios, necesito registrarte. Es muy rápido.

1️⃣ *¿Cuál es tu nombre completo?*`,
      { parse_mode: "Markdown" }
    )
  })
}
