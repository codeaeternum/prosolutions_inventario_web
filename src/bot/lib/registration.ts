import { Markup, type Context } from "telegraf"
import type { BotContext } from "./types"
import { customerTypeLabels } from "./types"
import { generateQRCode } from "./utils"
import { notifyAdmins } from "./notify"
import { getDefaultBusinessId } from "../../lib/settings"

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}
/** Both typed amounts and inline buttons submit the same pending approval request. */
export async function submitRegistration({ prisma, bot, sessions }: Pick<BotContext, "prisma" | "bot" | "sessions">, ctx: Context, goal: number): Promise<void> {
  const telegramId = ctx.from?.id.toString()
  if (!telegramId || ctx.chat?.type !== "private") return
  const session = sessions.registration[telegramId]
  if (!session || session.step !== "GOAL") return
  // Consume the wizard before writing so repeated texts, stale callbacks and retries cannot create a second account.
  delete sessions.registration[telegramId]
  const existing = await prisma.user.findUnique({ where: { telegramId } })
  if (existing) {
    await ctx.reply(existing.status === "PENDING"
      ? "⏳ Ya tienes una solicitud pendiente de aprobación. Un administrador la revisará pronto."
      : "✅ Ya tienes una cuenta registrada. Usa /ayuda para ver las opciones.")
    return
  }
  const requested = session.data.customerType
  const requestedCustomerType = requested === "TECHNICIAN" || requested === "STORE" ? requested : "NORMAL"
  const user = await prisma.user.create({ data: {
    businessId: await getDefaultBusinessId(),
    name: session.data.name!.slice(0, 200), phone: session.data.phone!.slice(0, 50),
    businessName: session.data.businessName?.slice(0, 200), telegramId, qrCode: generateQRCode(),
    role: "CUSTOMER", status: "PENDING", customerType: "NORMAL", requestedCustomerType,
    monthlyPurchaseGoal: Number.isFinite(goal) && goal > 0 ? Math.min(goal, 100000000) : null,
  } })
  await ctx.reply(`✅ Solicitud registrada.\n\nNombre: ${user.name}\nTipo solicitado: ${customerTypeLabels[requestedCustomerType]}\n\nTu cuenta está pendiente de aprobación. Un administrador confirmará el tipo de cuenta.`)
  await notifyAdmins(bot, `📢 <b>Nueva solicitud</b>\n\n${escapeHtml(user.name)}\n${escapeHtml(user.phone)}\n${escapeHtml(customerTypeLabels[requestedCustomerType])}`, Markup.inlineKeyboard([
    [Markup.button.callback("✅ Aprobar", `approve_user_${user.id}`)],
    [Markup.button.callback("❌ Rechazar", `reject_user_${user.id}`)],
  ]))
}
