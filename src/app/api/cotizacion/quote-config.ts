import { QUOTE_TTL_MS } from "@/lib/workshop-tokens"

// Vigencia y términos configurables de la cotización pública
// (SystemSettings por negocio: quote_validity_days, quote_terms).
//
// El dominio sigue guardando quoteExpiresAt = presentación + QUOTE_TTL_MS al
// (re)presentar la cotización; aquí se vuelve a aplicar la vigencia vigente
// del negocio: expiry = momento de presentación + quote_validity_days.
// Como la presentación se recupera restando el TTL histórico, una
// re-autorización que renovó quoteExpiresAt se respeta igual.
export const QUOTE_VALIDITY_DAYS_KEY = "quote_validity_days"
export const QUOTE_TERMS_KEY = "quote_terms"
export const QUOTE_VALIDITY_DAYS_MIN = 1
export const QUOTE_VALIDITY_DAYS_MAX = 90
export const QUOTE_VALIDITY_DAYS_DEFAULT = 15

/** Términos por defecto del documento (el texto que ya se imprimía). */
export const DEFAULT_QUOTE_TERMS =
  "Esta cotización es un estimado basado en el diagnóstico inicial. Si se detectan daños adicionales se le contactará antes de proceder."

const DAY_MS = 24 * 60 * 60 * 1000

/** Parsea `quote_validity_days`; ausente/inválido cae al default 15. */
export function parseQuoteValidityDays(raw: string | null | undefined): number {
  const days = Number(raw)
  return Number.isInteger(days) && days >= QUOTE_VALIDITY_DAYS_MIN && days <= QUOTE_VALIDITY_DAYS_MAX
    ? days
    : QUOTE_VALIDITY_DAYS_DEFAULT
}

/**
 * Vigencia efectiva de la cotización con `validityDays` días.
 * - Con quoteExpiresAt guardado: la presentación fue stored−TTL histórico,
 *   así que la vigencia real es stored + (validityDays − TTL histórico) —
 *   con el default de 15 días equivale exactamente a lo guardado y las
 *   renovaciones por re-autorización se conservan.
 * - Sin quoteExpiresAt (estimado informal, aún sin QUOTE): vence a los
 *   `validityDays` de la emisión (issuedAt), igual que promete el documento.
 * - Sin fecha base conocida: null (sin vigencia que aplicar).
 */
export function quoteExpiryDate(
  storedExpiresAt: Date | null,
  issuedAt: Date | null | undefined,
  validityDays: number,
): Date | null {
  if (storedExpiresAt) {
    return new Date(storedExpiresAt.getTime() - QUOTE_TTL_MS + validityDays * DAY_MS)
  }
  if (issuedAt) {
    return new Date(issuedAt.getTime() + validityDays * DAY_MS)
  }
  return null
}

/** true cuando la vigencia efectiva ya terminó. */
export function isQuoteExpiredAt(
  storedExpiresAt: Date | null,
  issuedAt: Date | null | undefined,
  validityDays: number,
  now = Date.now(),
): boolean {
  const expires = quoteExpiryDate(storedExpiresAt, issuedAt, validityDays)
  return expires !== null && expires.getTime() < now
}
