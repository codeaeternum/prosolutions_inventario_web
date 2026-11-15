import { randomBytes } from "crypto"

/**
 * Genera un código QR único para reservas (formato PS-XXXXXXXX).
 */
export function generateQRCode(): string {
  return `PS-${randomBytes(4).toString("hex").toUpperCase()}`
}

/**
 * Normaliza teléfono para guardar en BD: quita espacios y caracteres no numéricos.
 * Convierte a 10 dígitos y opcionalmente asume lada de México (52) si lo requieren para llamadas.
 * Para registro simple, con dejar números es suficiente.
 */
export function normalizePhone(input: string): string {
  const trimmed = input.trim()
  const digits = trimmed.replace(/\D/g, "")
  if (!digits) return trimmed
  if (digits.length === 10) return `52${digits}` // Asumir MX si mandan 10 dígitos para que funcionen links wa.me
  if (trimmed.startsWith("+")) {
    return `+${digits}`
  }
  return digits
}

/** Tope de espera para llamadas a la API de Telegram hechas por los crons:
 *  telegraf fija el timeout HTTP en ~500 s — un socket colgado congelaba el
 *  barrido completo (alertas de stock, resumen diario, turnos largos). */
export const TELEGRAM_API_TIMEOUT_MS = 30_000

/**
 * Corta la ESPERA sobre una promesa (p. ej. `bot.telegram.sendMessage`): si
 * no resuelve en `ms`, rechaza con un error claro para que el caller siga.
 * La promesa original NO se cancela (fetch de telegraf no expone abort por
 * llamada) — solo deja de bloquear; su rechazo tardío queda ya manejado por
 * el .then adjunto, así que no genera unhandledRejection.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = "operación"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // unref: el timer de espera no debe mantener vivo el event loop en el
    // shutdown del bot.
    const timer = setTimeout(() => reject(new Error(`${label} excedió ${ms} ms`)), ms)
    timer.unref()
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (err) => { clearTimeout(timer); reject(err) },
    )
  })
}

/** Dormir `ms` sin retener el event loop (unref, mismo patrón que withTimeout). */
export function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref()
  })
}

/** Tope del retry_after que Telegram manda en un 429 (cap de producto: 60 s). */
const TELEGRAM_RETRY_AFTER_CAP_S = 60

/**
 * Milisegundos que Telegram pide esperar en un error 429
 * (`err.response.parameters.retry_after`), tope 60 s. 0 cuando el error no
 * es rate-limit — el caller NO debe reintentar en ese caso.
 */
export function telegramRetryAfterMs(err: unknown): number {
  const params = (err as { response?: { parameters?: { retry_after?: unknown } } } | null)?.response?.parameters
  const secs = typeof params?.retry_after === "number" && Number.isFinite(params.retry_after) ? params.retry_after : 0
  return Math.min(Math.max(secs, 0), TELEGRAM_RETRY_AFTER_CAP_S) * 1000
}

/**
 * Ejecuta `fn` (p. ej. un sendMessage) y, si Telegram contesta 429 con
 * `retry_after`, duerme ese tiempo (cap 60 s) y reintenta UNA sola vez.
 * Cualquier otro error propaga tal cual — no hay colas ni reintentos extra.
 */
export async function retryOnTelegramLimit<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const waitMs = telegramRetryAfterMs(err)
    if (waitMs <= 0) throw err
    await sleep(waitMs)
    return fn()
  }
}
