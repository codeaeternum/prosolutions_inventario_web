import { Markup } from "telegraf"
import type { Context, Telegraf } from "telegraf"
import type { PrismaClient } from "@prisma/client"
import type { PendingTelegramLink, WizardState } from "../lib/types"
import { consumeVerificationCode, markVerified, VerificationError } from "../../lib/verification"
import { checkAndRecord } from "../../lib/rate-limit"
import { sendWelcomeEmail } from "../../lib/mailer"
import { errorText, escapeHtml, escapeMarkdownV1 } from "../lib/format"

export type { WizardState }

/**
 * Deep-link de verificación: /start verify_<6 dígitos>. El código viaja en el
 * link (canal TELEGRAM); aquí se consume, se marca phoneVerifiedAt y — si el
 * dueño del chat confirma con el botón inline — se liga el telegramId a la
 * cuenta que lo generó. Nunca se le quita a otro usuario ni se escribe sin
 * ese "sí": el link pudo ser abierto desde un chat equivocado.
 *
 * Un acierto liga ESTE telegramId a la cuenta del código, así que el link no
 * puede probarse en masa: consumeVerificationCode no puede contar un miss en
 * ninguna fila (el hash es la dirección), por eso el freno vive aquí — por
 * telegramId, en memoria del proceso del bot.
 */
const VERIFY_LINK_WINDOW_MS = 15 * 60 * 1000
const VERIFY_LINK_MAX_ATTEMPTS = 8

async function handleVerifyPayload(
  ctx: Context,
  prisma: PrismaClient,
  telegramId: string,
  code: string,
  linkSessions: Record<string, PendingTelegramLink>,
) {
  if (!checkAndRecord("verify-tg", telegramId, VERIFY_LINK_WINDOW_MS, VERIFY_LINK_MAX_ATTEMPTS)) {
    return ctx.reply("🔒 Demasiados intentos de verificación. Espera unos minutos o genera un código nuevo desde la app.")
  }
  try {
    const consumed = await consumeVerificationCode(prisma, { code, channel: "TELEGRAM" })

    if (!consumed.userId) {
      return ctx.reply("⚠️ Ese código no está ligado a ninguna cuenta. Genera uno nuevo desde /verificar.")
    }

    const target = await prisma.user.findUnique({
      where: { id: consumed.userId },
      select: { id: true, name: true, telegramId: true, business: { select: { name: true } } },
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
        .catch((err) => console.error("[bot/start] Error enviando bienvenida:", errorText(err)))
    }

    if (conflict) {
      return ctx.reply(
        `✅ Teléfono verificado para ${target.name}.\n\n` +
        `⚠️ Esta cuenta de Telegram ya está ligada a otro usuario, así que no la moví. ` +
        `Si es un error, desvincúlala primero con /desvincular o contacta al administrador.`
      )
    }

    if (target.telegramId === telegramId) {
      return ctx.reply(`✅ ¡Teléfono verificado, ${target.name}! Esta cuenta de Telegram ya estaba vinculada.`)
    }

    // Vincular escribe telegramId: solo tras confirmación inline del dueño
    // del chat (estado pendiente en RAM como los demás wizards; expira con
    // la TTL de sesión del proceso).
    linkSessions[telegramId] = {
      targetUserId: target.id,
      targetName: target.name,
      businessName: target.business?.name ?? undefined,
      replacing: !!target.telegramId,
    }
    const business = target.business?.name ? ` de <b>${escapeHtml(target.business.name)}</b>` : ""
    const replacing = target.telegramId ? "\n\n⚠️ Se reemplazará la vinculación anterior de esa cuenta." : ""
    return ctx.reply(
      `✅ Teléfono verificado.\n\n🔗 ¿Vincular esta cuenta de Telegram a <b>${escapeHtml(target.name)}</b>${business}?${replacing}`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("✅ Sí, vincular", "tglink_yes")],
          [Markup.button.callback("❌ No", "tglink_no")],
        ]),
      }
    )
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
    console.error("[bot/start] Error verificando código:", errorText(error))
    return ctx.reply("⚠️ No pude verificar el código. Intenta de nuevo en unos minutos.")
  }
}

export function registerStart(
  bot: Telegraf,
  prisma: PrismaClient | null,
  registrationSessions: Record<string, WizardState>,
  linkVerifySessions: Record<string, PendingTelegramLink> = {}
) {
  // Confirmación de la vinculación propuesta por el deep-link verify_<code>.
  bot.action("tglink_yes", async (ctx) => {
    const telegramId = ctx.from.id.toString()
    const pending = linkVerifySessions[telegramId]
    if (!pending || !prisma) {
      await ctx.answerCbQuery("Sesión expirada").catch(() => { })
      return ctx.editMessageText("❌ La solicitud de vinculación expiró. Genera un código nuevo desde la app.").catch(() => { })
    }
    delete linkVerifySessions[telegramId]
    try {
      const target = await prisma.user.findUnique({
        where: { id: pending.targetUserId },
        select: { id: true, name: true },
      })
      if (!target) {
        await ctx.answerCbQuery().catch(() => { })
        return ctx.editMessageText("⚠️ La cuenta ya no existe.")
      }
      // Re-chequeo de conflicto en el momento del "sí": el telegramId pudo
      // haberse ligado a otra cuenta entre el link y la confirmación.
      const holder = await prisma.user.findUnique({
        where: { telegramId },
        select: { id: true },
      })
      if (holder && holder.id !== target.id) {
        await ctx.answerCbQuery().catch(() => { })
        return ctx.editMessageText(
          "⚠️ Esta cuenta de Telegram ya está ligada a otro usuario. No la moví — desvincúlala primero con /desvincular."
        )
      }
      await prisma.user.update({ where: { id: target.id }, data: { telegramId } })
      await ctx.answerCbQuery("Vinculada").catch(() => { })
      await ctx.editMessageText(
        `✅ Telegram vinculado a <b>${escapeHtml(target.name)}</b>. Recibirás avisos por aquí.`,
        { parse_mode: "HTML" }
      )
    } catch (e) {
      console.error("[bot/start] Error en tglink_yes:", errorText(e))
      await ctx.answerCbQuery("❌ Error").catch(() => { })
    }
  })

  bot.action("tglink_no", async (ctx) => {
    const telegramId = ctx.from.id.toString()
    delete linkVerifySessions[telegramId]
    await ctx.answerCbQuery().catch(() => { })
    await ctx.editMessageText(
      "👍 Teléfono verificado; no se vinculó esta cuenta de Telegram. Puedes generar otro código desde la app cuando quieras."
    ).catch(() => { })
  })

  bot.start(async (ctx) => {
    const telegramId = ctx.from.id.toString()

    // /start verify_<6 dígitos> — verificación de teléfono post-registro web.
    const payload = typeof ctx.payload === "string" ? ctx.payload : ""
    const verifyMatch = payload.match(/^verify_(\d{6})$/)
    if (verifyMatch && prisma) {
      return handleVerifyPayload(ctx, prisma, telegramId, verifyMatch[1], linkVerifySessions)
    }

    if (prisma) {
      let user
      try {
        user = await prisma.user.findUnique({ where: { telegramId } })
      } catch (e) {
        // Con la BD caída no se puede registrar ni saludar por nombre: avisar
        // en vez de dejar el /start en silencio.
        console.error("[Start] Error consultando cuenta:", errorText(e))
        return ctx.reply("⚠️ No pude consultar tu cuenta. Intenta de nuevo en unos minutos.")
      }
      if (user) {
        const adminBadge = user.role === "ADMIN" ? " 👑" : ""
        return ctx.reply(
          `👋 *Hola de nuevo ${escapeMarkdownV1(user.name)}!*${adminBadge}

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
      `👋 *¡Bienvenido a Reficio!*

Para atenderte y darte los mejores precios, necesito registrarte. Es muy rápido.

1️⃣ *¿Cuál es tu nombre completo?*`,
      { parse_mode: "Markdown" }
    )
  })
}
