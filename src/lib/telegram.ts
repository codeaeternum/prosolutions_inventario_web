import { prisma } from "./prisma"

/**
 * Envía un mensaje HTML por Telegram a los usuarios del negocio indicado.
 * Replica lo que hace el bot (bot/lib/notify.ts) desde el proceso web:
 * la app ya tiene TELEGRAM_BOT_TOKEN en su entorno.
 * Falla en silencio (log): un aviso no debe romper la operación que lo dispara.
 */
export async function sendTelegramToUsers(
  businessId: string,
  message: string,
  filter: { role?: "ADMIN" | "EMPLOYEE" } = {},
): Promise<number> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return 0
  const users = await prisma.user.findMany({
    where: {
      businessId,
      telegramId: { not: null },
      status: "APPROVED",
      ...(filter.role ? { role: filter.role } : { role: { in: ["ADMIN", "EMPLOYEE"] } }),
    },
    select: { telegramId: true },
  })
  let sent = 0
  for (const user of users) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: user.telegramId, text: message, parse_mode: "HTML" }),
      })
      if (res.ok) sent++
    } catch (error) {
      console.error("[telegram] sendMessage falló:", error)
    }
  }
  return sent
}
