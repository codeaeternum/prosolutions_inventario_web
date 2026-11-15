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

/** Tope de espera por llamada a la Bot API desde el proceso web. */
const TELEGRAM_FETCH_TIMEOUT_MS = 8000
/** Cap de producto al retry_after que Telegram pida en un 429. */
const TELEGRAM_RETRY_AFTER_CAP_MS = 60_000

/**
 * POST /sendMessage con timeout de 8 s (un socket colgado antes congelaba el
 * bucle entero de destinatarios) y UNA reintentación cuando la API responde
 * 429: se lee `parameters.retry_after` del cuerpo, se espera (cap 60 s) y se
 * reintenta una sola vez. Sin colas: cualquier otro status devuelve la
 * respuesta original.
 */
async function postTelegramMessage(token: string, chatId: string, message: string): Promise<Response> {
  const send = () => fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" }),
    signal: AbortSignal.timeout(TELEGRAM_FETCH_TIMEOUT_MS),
  })
  const res = await send()
  if (res.status !== 429) return res
  let waitMs = 0
  try {
    const data = (await res.json()) as { parameters?: { retry_after?: unknown } } | null
    const secs = data?.parameters?.retry_after
    if (typeof secs === "number" && Number.isFinite(secs) && secs > 0) {
      waitMs = Math.min(secs * 1000, TELEGRAM_RETRY_AFTER_CAP_MS)
    }
  } catch {
    // Cuerpo ilegible en el 429: reintento inmediato igual vale una vez.
  }
  await new Promise<void>((resolve) => setTimeout(resolve, waitMs))
  return send()
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
    const res = await postTelegramMessage(token, telegramId, message)
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
    const res = await postTelegramMessage(token, customer.telegramId, message)
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
      // Timeout + reintento de 429 en postTelegramMessage: antes el fetch en
      // bucle no tenía timeout — un socket colgado congelaba toda la lista.
      const res = await postTelegramMessage(token, user.telegramId!, message)
      if (res.ok) sent++
    } catch (error) {
      console.error("[telegram] sendMessage falló:", error)
    }
  }
  return sent
}
