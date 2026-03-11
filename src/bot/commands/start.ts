import type { Telegraf } from "telegraf"
import type { PrismaClient } from "@prisma/client"

export interface WizardState {
  step: "NAME" | "TYPE" | "BUSINESS" | "PHONE" | "GOAL"
  data: {
    name?: string
    customerType?: "TECHNICIAN" | "STORE" | "NORMAL"
    businessName?: string
    phone?: string
    monthlyPurchaseGoal?: number
    telegramId?: string
  }
}

export function registerStart(
  bot: Telegraf,
  prisma: PrismaClient | null,
  registrationSessions: Record<string, WizardState>
) {
  bot.start(async (ctx) => {
    const telegramId = ctx.from.id.toString()

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
