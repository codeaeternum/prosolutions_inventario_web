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
