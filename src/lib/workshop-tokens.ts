import { randomUUID } from "node:crypto"

// Tokens públicos del taller: quoteToken (ver/aprobar cotización),
// uploadToken (QR del sticker para subir/ver evidencias sin login) y
// trackingToken (rastreo público /seguimiento?t=…, credencial no enumerable).
// Los dos primeros no deben vivir para siempre: el QR impreso queda en manos
// del cliente y un link permanente es una puerta trasera.

/** Vigencia del QR de evidencias mientras la orden está activa (1 año). */
export const UPLOAD_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000
/** Vigencia de la cotización pública, acorde al texto "Válida por 15 días". */
export const QUOTE_TTL_MS = 15 * 24 * 60 * 60 * 1000

export function newUploadToken(): string {
  return randomUUID()
}

export function newQuoteToken(): string {
  return randomUUID()
}

/**
 * Token de rastreo público: sustituye a folio + últimos 4 dígitos del teléfono
 * (credencial enumerable: folio secuencial × 10⁴ teléfonos). A diferencia del
 * uploadToken NO rota ni caduca al entregar: el cliente conserva el link para
 * ver el historial post-entrega — solo expone datos ya saneados para público.
 */
export function newTrackingToken(): string {
  return randomUUID()
}

/** Campos a escribir al crear la orden: token de evidencias con caducidad. */
export function uploadTokenFields(now = new Date()) {
  return {
    uploadToken: newUploadToken(),
    uploadTokenExpiresAt: new Date(now.getTime() + UPLOAD_TOKEN_TTL_MS),
  }
}

/**
 * Rotación: revoca el token actual (los links/QR viejos mueren) y emite uno
 * nuevo. Úsese al cerrar la orden en estado terminal y desde la acción admin
 * "regenerar link" si un QR se extravió o se sospecha difusión.
 */
export function rotatedUploadToken(now = new Date()) {
  return {
    uploadToken: newUploadToken(),
    uploadTokenExpiresAt: new Date(now.getTime() + UPLOAD_TOKEN_TTL_MS),
  }
}

/** Vigencia que se fija al presentar la cotización al cliente. */
export function quoteExpiry(now = new Date()) {
  return new Date(now.getTime() + QUOTE_TTL_MS)
}
