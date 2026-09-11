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
