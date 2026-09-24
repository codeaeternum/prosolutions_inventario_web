import type { Prisma, PrismaClient } from "@prisma/client"
import { ALERTED_ACTIONS, alertSensitiveAudit } from "./audit-alerts"

/**
 * Bitácora administrativa (AuditEvent): quién hizo qué sobre datos del
 * negocio. Complementa a BusinessOperation (recibos idempotentes de dinero /
 * stock) y RepairEvent (taller) cubriendo las ediciones administrativas que
 * antes eran invisibles: un precio editado, un rol cambiado, un ajuste de
 * configuración.
 *
 * Reglas del módulo:
 * - recordAudit NUNCA lanza: la auditoría es un testigo, no un guardián. Si
 *   la escritura del evento falla, la operación de negocio ya ocurrió y no
 *   debe revertirse por un problema del bitácora (se loguea y se sigue).
 * - `changes` jamás incluye passwords, PINs, hashes ni tokens: las rutas
 *   arman el diff solo con campos visibles y maskSensitiveChanges cubre las
 *   llaves de settings cuyo nombre delate un secreto.
 * - Las acciones sensibles (ALERTED_ACTIONS) hechas por un NO-admin además
 *   gritan al dueño por Telegram (lib/audit-alerts), fire-and-forget después
 *   de persistir: ni bloquean ni pueden revertir la operación.
 */

/** Un campo que cambió: valor anterior y valor nuevo (serializables a JSON). */
export type AuditChange = { before: Prisma.InputJsonValue; after: Prisma.InputJsonValue }
export type AuditChanges = Record<string, AuditChange>

export type AuditEntry = {
  businessId: string
  actorId: string
  action: string // "PRODUCT_UPDATE", "USER_UPDATE", "SETTINGS_UPDATE", ...
  entity: string // "product" | "user" | "settings" | "supplier" | "category" | "brand" | "model" | "branch" | "customer" | "business"
  entityId?: string | null
  entityName?: string | null
  summary: string
  changes?: AuditChanges | Prisma.InputJsonValue | null
}

// Cliente mínimo: el prisma global o el tx de una transacción interactiva.
type AuditWriter = Pick<PrismaClient, "auditEvent"> | Prisma.TransactionClient

/**
 * Graba un evento de auditoría. Nunca lanza: si la bitácora falla, el
 * negocio ya quedó escrito y un throw aquí convertiría una operación exitosa
 * en un 500 confuso; preferimos perder el rastro (logueado) que romper la
 * operación.
 */
export async function recordAudit(db: AuditWriter, entry: AuditEntry): Promise<void> {
  try {
    await db.auditEvent.create({
      data: {
        businessId: entry.businessId,
        actorId: entry.actorId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        entityName: entry.entityName ?? null,
        summary: entry.summary,
        changes: entry.changes ?? undefined,
      },
    })
  } catch (error) {
    console.error("[audit] No se pudo registrar el evento:", error)
    return
  }
  // Aviso Telegram al dueño cuando un no-admin hace algo sensible. Va
  // fire-and-forget (sin await): la alerta es accesoria — ni suma latencia a
  // la respuesta ni puede romper la operación ya persistida. Además lee el
  // rol del actor con el prisma global, no con `db` (puede ser un tx ya
  // cerrado para cuando Telegram responda).
  if (ALERTED_ACTIONS.has(entry.action)) void alertSensitiveAudit(entry)
}

/** null/undefined se normalizan a "sin valor"; objetos/arreglos por contenido. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  const normA = a === undefined ? null : a
  const normB = b === undefined ? null : b
  if (Object.is(normA, normB)) return true
  if (typeof normA === "object" || typeof normB === "object") {
    return JSON.stringify(normA) === JSON.stringify(normB)
  }
  return false
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return (value === undefined ? null : value) as Prisma.InputJsonValue
}

/**
 * Compara `before` y `after` solo en `fields` y devuelve
 * `{ campo: { before, after } }` de los que cambiaron, o null si nada cambió
 * (la ruta entonces NO debe grabar evento). Null-safe y con arreglos
 * comparados por contenido — pensado para productos, usuarios y settings.
 */
export function diffChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  fields: readonly string[],
): AuditChanges | null {
  const diff: AuditChanges = {}
  for (const field of fields) {
    const b = before?.[field]
    const a = after?.[field]
    if (!sameValue(b, a)) {
      diff[field] = { before: toJson(b), after: toJson(a) }
    }
  }
  return Object.keys(diff).length > 0 ? diff : null
}

// Llaves de settings cuyo VALOR no debe quedar en la bitácora (secretos).
// bank_transfer_info / bank_cash_info NO están aquí: son datos públicos del
// negocio (CLABE/cuenta visible al cliente), no credenciales.
const SENSITIVE_KEY_RE = /password|passwd|secret|token|credential|private|pin/i

/**
 * Reemplaza por "•••" los valores de campos cuyo nombre sugiere un secreto.
 * Defensa en profundidad: las rutas ya eligen qué campos auditar, pero si
 * alguna llave sensible se cuela, aquí se censura antes de persistir.
 */
export function maskSensitiveChanges(changes: AuditChanges | null): AuditChanges | null {
  if (!changes) return changes
  const masked: AuditChanges = {}
  for (const [key, change] of Object.entries(changes)) {
    masked[key] = SENSITIVE_KEY_RE.test(key)
      ? { before: "•••", after: "•••" }
      : change
  }
  return masked
}

/** "$500.00" estilo MXN, server-side (formatPrice de utils es para UI). */
const moneyFormatter = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" })
export function money(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? moneyFormatter.format(n) : "—"
}

/**
 * Lista legible para summaries: ["ventas","caja"] → "[ventas, caja]";
 * vacía/no arreglo → `emptyLabel` (p. ej. "todos" cuando la lista vacía
 * significa sin restricción, como allowedModules/allowedBranchIds).
 */
export function listText(value: unknown, emptyLabel = "[]"): string {
  return Array.isArray(value) && value.length > 0 ? `[${value.join(", ")}]` : emptyLabel
}
