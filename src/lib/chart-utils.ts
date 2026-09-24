// Helpers puros para dar forma a las series de las gráficas de reportes.
// Las claves de día/mes ("YYYY-MM-DD" / "YYYY-MM") se derivan en la zona del
// negocio (BUSINESS_TIME_ZONE): un día del reporte cubre 00:00–23:59 hora de
// México, igual que los filtros from/to (parseBusinessDateParam). La API
// agrupa cada fila con businessDayKey/businessMonthKey de business-time.ts.
import { BUSINESS_TIME_ZONE, businessDayKey, businessMonthKey } from "./business-time"

/** Claves de los últimos `n` días en la zona del negocio, ascendente, incluyendo hoy. */
export function lastDayKeys(n: number, end: Date = new Date(), timeZone: string = BUSINESS_TIME_ZONE): string[] {
  const keys: string[] = []
  // "Hoy" es el día del negocio: a las 18:01 MX ya es el día siguiente en
  // UTC y las ventas de la tarde no deben quedar fuera del rango.
  const [year, month, day] = businessDayKey(end, timeZone).split("-").map(Number)
  const today = Date.UTC(year, month - 1, day)
  for (let i = n - 1; i >= 0; i--) {
    keys.push(new Date(today - i * 86_400_000).toISOString().slice(0, 10))
  }
  return keys
}

/** Claves de los últimos `n` meses en la zona del negocio ("YYYY-MM"), ascendente, incluyendo el actual. */
export function lastMonthKeys(n: number, end: Date = new Date(), timeZone: string = BUSINESS_TIME_ZONE): string[] {
  const keys: string[] = []
  const [year, month] = businessMonthKey(end, timeZone).split("-").map(Number)
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(year, month - 1 - i, 1))
    keys.push(d.toISOString().slice(0, 7))
  }
  return keys
}

/**
 * Devuelve una entrada por cada clave de `days`, rellenando con `zero` los
 * días que no tienen fila en `rows`. Las filas con día fuera del rango se
 * ignoran; `zero` y `rows` no se mutan.
 */
export function fillDays<V extends Record<string, number>>(
  days: readonly string[],
  rows: ReadonlyArray<{ day: string } & Partial<V>>,
  zero: V
): Array<{ day: string } & V> {
  const byDay = new Map(rows.map((r) => [r.day, r]))
  return days.map((day) => ({ day, ...zero, ...byDay.get(day) }))
}

/** Igual que `fillDays` pero para claves de mes ("YYYY-MM"). */
export function fillMonths<V extends Record<string, number>>(
  months: readonly string[],
  rows: ReadonlyArray<{ month: string } & Partial<V>>,
  zero: V
): Array<{ month: string } & V> {
  const byMonth = new Map(rows.map((r) => [r.month, r]))
  return months.map((month) => ({ month, ...zero, ...byMonth.get(month) }))
}
