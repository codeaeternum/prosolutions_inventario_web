// Helpers puros para dar forma a las series de las gráficas de reportes.
// Las claves de día/mes usan UTC ("YYYY-MM-DD" / "YYYY-MM") igual que el API,
// que agrupa con `createdAt.toISOString().slice(...)`.

/** Claves de los últimos `n` días en UTC, ascendente, incluyendo hoy. */
export function lastDayKeys(n: number, end: Date = new Date()): string[] {
  const keys: string[] = []
  const today = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
  for (let i = n - 1; i >= 0; i--) {
    keys.push(new Date(today - i * 86_400_000).toISOString().slice(0, 10))
  }
  return keys
}

/** Claves de los últimos `n` meses en UTC ("YYYY-MM"), ascendente, incluyendo el actual. */
export function lastMonthKeys(n: number, end: Date = new Date()): string[] {
  const keys: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1))
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
