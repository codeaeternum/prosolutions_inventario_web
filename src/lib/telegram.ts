import { prisma } from "./prisma"

let cachedBotUsername: string | null | undefined

/**
 * Username público del bot (sin @) para armar deep-links t.me/<bot>?start=…
 * Preferencia: env TELEGRAM_BOT_USERNAME; si no, se resuelve una vez con la
 * API getMe usando TELEGRAM_BOT_TOKEN y se cachea. null = no disponible (el
 * canal de verificación por Telegram queda deshabilitado sin romper nada).
 */
export async function getTelegramBotUsername(): Promise<string | null> {
  if (cachedBotUsername !== undefined) return cachedBotUsername
  const fromEnv = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "")
  if (fromEnv) {
    cachedBotUsername = fromEnv
    return cachedBotUsername
  }
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    cachedBotUsername = null
    return null
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(5000),
    })
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean
      result?: { username?: string }
    } | null
    cachedBotUsername = res.ok && data?.ok && data.result?.username ? data.result.username : null
  } catch (error) {
    console.error("[telegram] getMe falló:", error)
    cachedBotUsername = null
  }
  return cachedBotUsername
}

/**
 * Deep-link de verificación por Telegram: el código viaja dentro del payload
 * /start verify_<código> y el bot lo consume al abrir el chat. Es el canal de
 * entrega del código — por eso es el único lugar donde sale en claro fuera
 * de lib/verification.ts. null si el bot no tiene username resoluble.
 */
export async function buildTelegramVerifyUrl(code: string): Promise<string | null> {
  const username = await getTelegramBotUsername()
  return username ? `https://t.me/${username}?start=verify_${code}` : null
}

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
