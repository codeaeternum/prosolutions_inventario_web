import { BusinessError, type Transaction } from "./operations"

/**
 * Folio por tenant para RepairOrder.number (BusinessCounter).
 *
 * Antes `number` era un autoincrement GLOBAL multi-tenant: las órdenes de
 * otros negocios y las espejos de delegación consumían números, así que el
 * folio de cada taller tenía huecos garantizados y además del volumen de la
 * plataforma quedaba expuesto al comparar saltos. Ahora cada negocio tiene
 * una fila en BusinessCounter con el próximo folio disponible; el único
 * @@unique([businessId, number]) del schema es la red de seguridad.
 *
 * Ventaja sobre MAX(number)+1 (patrón de Purchase/InventoryCount): el
 * UPDATE … RETURNING toma un lock de fila y no exige serializar lecturas
 * de TODA la tabla del tenant. Y a diferencia de una secuencia de Postgres,
 * el incremento es TRANSACCIONAL: si la operación aborta o reintenta, el
 * número reservado se revierte con el rollback — no se queman folios.
 *
 * Integración: el dominio que crea la orden llama a nextOrderNumber()
 * dentro de operation()/transaction() y fija `number` en el create.
 * createRepair (workshop.ts) es el punto único de alta de órdenes —
 * también cubre las espejos que delegation.ts crea a través de él.
 *
 * Formato visible: repairFolio(number, digits) en lib/workshop-labels
 * ("OT-000123", prefijo `order_prefix` y dígitos `order_folio_digits`
 * configurables por negocio en SystemSettings).
 */

/**
 * Reserva y devuelve el próximo folio de taller del negocio.
 *
 * Un solo statement atómico:
 *   - INSERT … ON CONFLICT DO UPDATE incrementa el contador bajo lock de
 *     fila; RETURNING devuelve el valor previo al incremento.
 *   - Si el negocio no tiene fila (creado fuera del backfill o sin que el
 *     alta de negocio lo genere), el INSERT la siembra desde
 *     MAX(RepairOrder.number)+1: el folio continúa el histórico en vez de
 *     reiniciar en 1 y chocar con el único compuesto.
 *
 * Debe llamarse dentro de la transacción serializable de operation():
 * bajo concurrencia del mismo tenant el segundo llamado puede terminar en
 * P2034/40001 y transaction() reintenta la operación completa con el
 * folio siguiente — comportamiento esperado, no un error.
 */
export async function nextOrderNumber(tx: Transaction, businessId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ n: number }[]>`
    INSERT INTO "BusinessCounter" ("businessId", "nextOrderNumber")
    VALUES (${businessId}, (
      SELECT COALESCE(MAX("number"), 0) + 2 FROM "RepairOrder" WHERE "businessId" = ${businessId}
    ))
    ON CONFLICT ("businessId")
    DO UPDATE SET "nextOrderNumber" = "BusinessCounter"."nextOrderNumber" + 1
    RETURNING "nextOrderNumber" - 1 AS "n"
  `
  const n = rows[0]?.n
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) {
    // Solo alcanzable si la BD responde algo inconsistente (la fila siempre
    // existe tras el upsert y el default es 1). Mejor fallar la operación
    // que grabar una orden con folio basura.
    throw new BusinessError("No se pudo reservar el folio de la orden.", 500, "FOLIO_UNAVAILABLE")
  }
  return n
}

/**
 * Reserva y devuelve el próximo folio de venta del negocio (Sale.number).
 *
 * Un solo statement atómico sobre BusinessCounter.nextSaleNumber:
 *   - INSERT … ON CONFLICT DO UPDATE incrementa el contador bajo lock de
 *     fila; RETURNING devuelve el valor previo al incremento.
 *   - Si el negocio aún no tiene fila en BusinessCounter, el INSERT la
 *     siembra desde MAX(Sale.number)+1 del tenant para continuar el
 *     histórico sin chocar con @@unique([businessId, number]).
 */
export async function nextSaleNumber(tx: Transaction, businessId: string): Promise<number> {
  if (typeof (tx as { $queryRaw?: unknown }).$queryRaw !== "function") {
    return 1
  }
  const rows = await tx.$queryRaw<{ n: number }[]>`
    INSERT INTO "BusinessCounter" ("businessId", "nextSaleNumber")
    VALUES (${businessId}, (
      SELECT COALESCE(MAX("number"), 0) + 2 FROM "Sale" WHERE "businessId" = ${businessId}
    ))
    ON CONFLICT ("businessId")
    DO UPDATE SET "nextSaleNumber" = "BusinessCounter"."nextSaleNumber" + 1
    RETURNING "nextSaleNumber" - 1 AS "n"
  `
  const n = rows[0]?.n
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) {
    throw new BusinessError("No se pudo reservar el folio de la venta.", 500, "FOLIO_UNAVAILABLE")
  }
  return n
}
