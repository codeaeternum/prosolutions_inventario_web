/**
 * Zona horaria operativa del negocio.
 *
 * `Business` no tiene campo timezone en el schema: el SaaS opera en México,
 * así que la zona es una constante de producto. Si en el futuro un tenant
 * opera en otra zona, esto se convierte en configuración por negocio.
 */
export const BUSINESS_TIME_ZONE = "America/Mexico_City"

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function wallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone)
  if (!fmt) {
    // hourCycle h23: garantiza horas 0-23 (con "en-US" a secas la medianoche
    // puede salir como 24 en algunas versiones de ICU).
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    formatterCache.set(timeZone, fmt)
  }
  return fmt
}

/**
 * Desfase en ms de `timeZone` respecto a UTC en el instante dado
 * (positivo al este de Greenwich: Asia/Tokyo ≈ +9h; negativo al oeste:
 * America/Mexico_City = −6h, o −5h en las fechas históricas con horario de
 * verano previo a 2023).
 */
export function timeZoneOffsetMs(timeZone: string, instant: Date): number {
  const parts = wallClockFormatter(timeZone).formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find(p => p.type === type)?.value ?? 0)
  const wallAsUtc = Date.UTC(
    get("year"), get("month") - 1, get("day"),
    get("hour"), get("minute"), get("second"),
  )
  // formatToParts no devuelve milisegundos: se trunca el instante al segundo.
  const epochSecondsMs = Math.floor(instant.getTime() / 1000) * 1000
  return wallAsUtc - epochSecondsMs
}

/**
 * Hora de pared (año-mes-día h:m:s.ms) expresada en `timeZone` → instante UTC
 * real. En bordes de cambio de horario el desfase del primer cálculo puede no
 * ser el del instante final, así que se verifica una segunda vez.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
  timeZone: string = BUSINESS_TIME_ZONE,
): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond)
  const firstOffset = timeZoneOffsetMs(timeZone, new Date(wallAsUtc))
  let utcMs = wallAsUtc - firstOffset
  const correctedOffset = timeZoneOffsetMs(timeZone, new Date(utcMs))
  if (correctedOffset !== firstOffset) utcMs = wallAsUtc - correctedOffset
  return new Date(utcMs)
}

/**
 * Clave de día "YYYY-MM-DD" del instante en la zona del negocio. Es el
 * bucket de las series de reportes: una venta de las 17:30 MX pertenece al
 * día MX aunque en UTC ya sea el día siguiente.
 */
export function businessDayKey(instant: Date, timeZone: string = BUSINESS_TIME_ZONE): string {
  const parts = wallClockFormatter(timeZone).formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? "00"
  return `${get("year")}-${get("month")}-${get("day")}`
}

/** Clave de mes "YYYY-MM" del instante en la zona del negocio. */
export function businessMonthKey(instant: Date, timeZone: string = BUSINESS_TIME_ZONE): string {
  return businessDayKey(instant, timeZone).slice(0, 7)
}

const SHORT_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Filtro `from`/`to` de reportes y bitácora: una fecha corta "YYYY-MM-DD"
 * significa el DÍA COMPLETO del negocio — edge "start" = 00:00:00.000 y
 * edge "end" = 23:59:59.999 en BUSINESS_TIME_ZONE (no UTC ni la hora del
 * servidor, que en producción suele correr en UTC y desfasa el rango ~6 h).
 *
 * Valores que ya traen hora o van en ISO completo ("2025-06-30T18:00:00Z",
 * "2025-06-30T18:00-06:00") se interpretan tal cual. Vacíos o inválidos
 * devuelven null (sin límite en esa punta del rango).
 */
export function parseBusinessDateParam(
  raw: string | null | undefined,
  edge: "start" | "end",
  timeZone: string = BUSINESS_TIME_ZONE,
): Date | null {
  const value = raw?.trim()
  if (!value) return null
  if (SHORT_DATE.test(value)) {
    const [year, month, day] = value.split("-").map(Number)
    return edge === "end"
      ? zonedTimeToUtc(year, month, day, 23, 59, 59, 999, timeZone)
      : zonedTimeToUtc(year, month, day, 0, 0, 0, 0, timeZone)
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
