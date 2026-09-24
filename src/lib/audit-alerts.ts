/**
 * Alertas Telegram por actividad sensible (complemento de lib/audit).
 *
 * recordAudit es el testigo que persiste; este módulo es el grito: avisa al
 * dueño (usuarios ADMIN con telegramId) cuando un NO-admin hace algo que
 * mueve dinero o accesos — un precio editado, un usuario borrado, un límite
 * de crédito cambiado. Si el propio dueño lo hace, no hay alerta: ya lo sabe.
 *
 * Reglas del módulo (mismas que audit):
 * - alertSensitiveAudit NUNCA lanza: la operación de negocio ya ocurrió y un
 *   fallo del aviso no debe propagarse (se loguea y se sigue).
 * - El rol del actor se lee con el prisma global por import perezoso, NUNCA
 *   con el tx que grabó el evento: para cuando corre la alerta, la
 *   transacción pudo ya estar cerrada.
 */

/** Acciones que ameritan aviso al dueño. PRODUCT_UPDATE solo avisa si toca precio (ver touchesPrice). */
export const ALERTED_ACTIONS: ReadonlySet<string> = new Set([
  "PRODUCT_UPDATE",
  "PRODUCT_DELETE",
  "PRODUCT_IMPORT",
  "USER_CREATE",
  "USER_UPDATE",
  "USER_DELETE",
  "CUSTOMER_UPDATE", // límite de crédito del cliente
  "SETTINGS_UPDATE",
  "SUPPLIER_DELETE",
])

export type AuditAlertEntry = {
  businessId: string
  actorId: string
  action: string
  entityName?: string | null
  summary: string
  /** Diff de lib/audit; sirve para decidir si PRODUCT_UPDATE tocó precio. */
  changes?: unknown
}

/** Llaves del diff de producto que significan dinero para el dueño. */
const PRICE_CHANGE_KEYS = new Set(["precio", "mayoreo", "costo"])

// Telegram interpreta el mensaje como HTML (parse_mode HTML): un "<" o "&"
// en un nombre de producto/usuario invalidaría el envío, así que se escapan.
const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/**
 * Anti-spam en memoria: el mismo actor repitiendo la misma acción en el
 * mismo negocio avisa 1 vez por minuto — si Kevin hace 5 edits seguidos al
 * mismo precio solo llega 1 Telegram. Proceso-local (igual que el cooldown
 * de low-stock): suficiente para un despliegue de un solo proceso.
 */
const ALERT_THROTTLE_MS = 60 * 1000
const lastAlertAt = new Map<string, number>()
const THROTTLE_CLEANUP_SIZE = 200

function isThrottled(key: string, now: number): boolean {
  const last = lastAlertAt.get(key)
  if (last !== undefined && now - last < ALERT_THROTTLE_MS) return true
  // Limpieza oportunista: purga marcas viejas para que el mapa no crezca
  // sin límite en procesos longevos.
  if (lastAlertAt.size > THROTTLE_CLEANUP_SIZE) {
    for (const [k, t] of lastAlertAt) {
      if (now - t >= ALERT_THROTTLE_MS) lastAlertAt.delete(k)
    }
  }
  return false
}

/**
 * PRODUCT_UPDATE solo alarma si movió dinero: el diff trae precio/mayoreo/
 * costo o — si no hay diff utilizable — el summary lo menciona
 * ("Precio $500.00 → $450.00").
 */
function touchesPrice(entry: AuditAlertEntry): boolean {
  const { changes } = entry
  if (changes && typeof changes === "object" && !Array.isArray(changes)) {
    for (const key of Object.keys(changes)) {
      if (PRICE_CHANGE_KEYS.has(key)) return true
    }
  }
  return /precio|costo|mayoreo/i.test(entry.summary)
}

const mxDateTime = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mexico_City",
  dateStyle: "short",
  timeStyle: "short",
})

/**
 * Avisa a los ADMIN del negocio por Telegram si el evento es sensible y el
 * actor no es admin. Se llama fire-and-forget desde recordAudit: 1 query
 * para el rol + el envío; cualquier fallo se loguea y se traga.
 */
export async function alertSensitiveAudit(entry: AuditAlertEntry): Promise<void> {
  try {
    if (!ALERTED_ACTIONS.has(entry.action)) return
    if (entry.action === "PRODUCT_UPDATE" && !touchesPrice(entry)) return

    const lines = [
      "⚠️ <b>Actividad sensible</b>",
      // El nombre del actor lo inserta notifyOwner tras verificar el rol.
      `<b>{actor}</b> ${escapeHtml(entry.summary)}`,
    ]
    if (entry.entityName) lines.push(`📌 ${escapeHtml(entry.entityName)}`)
    await notifyOwner(entry.businessId, entry.actorId, `audit:${entry.action}`, lines)
  } catch (error) {
    console.error("[audit-alerts] alertSensitiveAudit falló:", error)
  }
}

/**
 * Núcleo compartido con las alertas de operaciones (lib/operation-alerts):
 * verifica rol del actor, aplica el throttle y envía a los ADMIN del tenant.
 * `lines` puede traer el marcador literal "{actor}" que se sustituye por el
 * nombre ya escapado una vez conocido. Devuelve true si se envió.
 */
export async function notifyOwner(businessId: string, actorId: string, throttleKey: string, lines: string[]): Promise<boolean> {
  const key = `${businessId}:${actorId}:${throttleKey}`
  const now = Date.now()
  if (isThrottled(key, now)) return false

  // Import perezoso: lib/prisma exige DATABASE_URL al cargar y solo debe
  // cargarse cuando de verdad hay candidato a alerta.
  const { prisma } = await import("./prisma")
  const actor = await prisma.user.findUnique({
    where: { id: actorId, businessId },
    select: { role: true, name: true },
  })
  // Solo alarman las manos ajenas: si el dueño (o algo sin usuario en el
  // tenant) hizo el cambio ya lo sabe — alertarlo sería spam.
  if (!actor || actor.role === "ADMIN") return false

  // La marca va antes del envío: si Telegram falla, los reintentos del
  // mismo minuto tampoco martillean la API.
  lastAlertAt.set(key, now)
  const rendered = lines.map(line => line.replace("{actor}", escapeHtml(actor.name)))
  rendered.push(`🕒 ${mxDateTime.format(new Date(now))}`)

  // Igual que low-stock/delegation: import perezoso (tira de lib/prisma) +
  // fallo en silencio cubierto por el try exterior.
  const { sendTelegramToUsers } = await import("./telegram")
  await sendTelegramToUsers(businessId, rendered.join("\n"), { role: "ADMIN" })
  return true
}

/** Escape HTML reutilizable para armar líneas de alerta con datos de usuario. */
export function escapeAlertHtml(value: string): string {
  return escapeHtml(value)
}
