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
 * Escape mínimo para parse_mode HTML de Telegram: un "<" o "&" suelto en
 * un nombre o descripción invalidaría el envío completo (HTTP 400).
 */
export function escapeTelegramHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/**
 * Mensaje HTML directo a un chat de Telegram ya resuelto (telegramId ligado).
 * A diferencia de sendTelegramToCustomer no filtra por rol/tenant: el caller
 * ya validó a quién le escribe (p. ej. la re-verificación del perfil al
 * dueño de la sesión). Silencioso con log; devuelve si se envió.
 */
export async function sendTelegramMessage(telegramId: string, message: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return false
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegramId, text: message, parse_mode: "HTML" }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) console.error(`[telegram] sendMessage directo falló: HTTP ${res.status}`)
    return res.ok
  } catch (error) {
    console.error("[telegram] sendMessage directo falló:", error)
    return false
  }
}

/**
 * Envía un mensaje HTML por Telegram a UN cliente del negocio: User con
 * role CUSTOMER y telegramId ligado (alta por /start del bot o deep-link
 * verify_<code>). El filtro businessId + role es el guard multi-tenant:
 * jamás se escribe a un telegramId de otro tenant ni a una cuenta de staff.
 * Devuelve false si el cliente no tiene Telegram ligado o el envío falla —
 * silencioso con log: un aviso no debe romper la operación que lo dispara.
 */
export async function sendTelegramToCustomer(
  businessId: string,
  customerId: string,
  message: string,
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return false
  const customer = await prisma.user.findFirst({
    where: { id: customerId, businessId, role: "CUSTOMER", telegramId: { not: null } },
    select: { telegramId: true },
  })
  if (!customer?.telegramId) return false
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: customer.telegramId, text: message, parse_mode: "HTML" }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) console.error(`[telegram] sendMessage a cliente falló: HTTP ${res.status}`)
    return res.ok
  } catch (error) {
    console.error("[telegram] sendMessage a cliente falló:", error)
    return false
  }
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
