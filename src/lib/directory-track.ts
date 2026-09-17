/**
 * Tracking client-side del directorio público (/mercado).
 *
 * IMPORTANTE: este archivo se importa desde client components — NO puede
 * importar prisma, auth ni nada de servidor (directory-events.ts incluido).
 * Solo fetch/sendBeacon contra el endpoint público.
 */

const EVENTS_URL = "/api/directory/events"

/**
 * Registra un click hacia la vitrina de un negocio del directorio.
 *
 * Usa sendBeacon cuando está disponible (sobrevive a la navegación que el
 * propio click dispara); si no, fetch keepalive. Nunca lanza ni bloquea —
 * la telemetría jamás interrumpe la navegación del usuario.
 */
export function trackDirectoryClick(slug: string): void {
  if (!slug) return
  const payload = JSON.stringify({ kind: "click", slug })
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([payload], { type: "application/json" })
      if (navigator.sendBeacon(EVENTS_URL, blob)) return
    }
    void fetch(EVENTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {
      // Telemetría best-effort: un fallo de red se ignora en silencio.
    })
  } catch {
    // Jamás propagar: el click del usuario siempre gana.
  }
}
