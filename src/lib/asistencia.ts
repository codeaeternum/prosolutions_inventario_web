import { businessDayKey } from "@/lib/business-time"

/**
 * Asistencia real (checador). Un ClockEvent es una entrada ("IN") o salida
 * ("OUT") que el propio usuario registra en POST /api/asistencia. De la
 * secuencia de eventos se derivan JORNADAS: cada IN abre una y el siguiente
 * OUT la cierra.
 *
 * Reglas honestas (no se inventan cierres):
 * - Una jornada puede cruzar medianoche pero dura a lo sumo 16 h. Un OUT que
 *   llega más de 16 h después del IN ya no es un cierre confiable (checada
 *   olvidada): la jornada queda `openEnded` y NO aporta minutos.
 * - IN sin OUT con más de 16 h de silencio también queda `openEnded`.
 * - IN sin OUT todavía dentro de la ventana = jornada `open`: sus minutos
 *   cuentan hasta `now` (la persona sigue trabajando).
 * - Para los reportes por día la jornada se atribuye al DÍA-NEGOCIO de su
 *   IN: un turno 20:00→02:00 suma sus 6 h completas al día en que empezó.
 */

/** Ventana máxima de una jornada: pasadas 16 h sin OUT se abandona. */
export const JORNADA_MAX_MS = 16 * 60 * 60 * 1000

/** Umbral de jornada abierta prolongada: a partir de 10 h (600 min) se alerta. */
export const JORNADA_ALERTA_MIN = 600
export const JORNADA_ALERTA_MS = 10 * 60 * 60 * 1000

export interface ClockEventLike {
  id: string
  type: string
  at: Date
  branchId?: string | null
  note?: string | null
}

export interface JornadaDerivada {
  inEventId: string
  /** ISO del IN que abrió la jornada. */
  inAt: string
  branchId: string | null
  outEventId: string | null
  /** ISO del OUT real; null si la jornada sigue abierta o quedó abandonada
   *  (el OUT tardío no se presenta como cierre: no se inventa el fin). */
  outAt: string | null
  /** Minutos trabajados: IN→OUT cerrada, o IN→`now` cuando sigue abierta.
   *  null en jornada abandonada (openEnded): no se inventan minutos. */
  minutos: number | null
  /** IN sin OUT dentro de la ventana de 16 h: la jornada sigue corriendo. */
  open: boolean
  /** Jornada abandonada: pasaron >16 h sin un cierre confiable. */
  openEnded: boolean
  /** Jornada abierta prolongada: `open` con >= 600 min (entre 10 h y 16 h). */
  longShift?: boolean
  /** Fuente de la jornada — las derivadas aquí siempre salen del checador;
   *  la bandera existe para que la UI distinga fuentes cuando se mezclen. */
  source: "clock" | "activity"
}

/**
 * Deriva las jornadas de la secuencia de eventos de UN usuario (se ordenan
 * por `at`). Eventos huérfanos (OUT sin IN abierta, IN duplicado a <16 h del
 * anterior — la API los rechaza, pero pueden existir datos sembrados a mano)
 * se tratan de forma determinista: un IN nuevo abandona la jornada que
 * quedó abierta y un OUT sin abierta se descarta.
 */
export function deriveJornadas(events: ClockEventLike[], now: Date = new Date()): JornadaDerivada[] {
  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime())
  const jornadas: JornadaDerivada[] = []
  let openIn: ClockEventLike | null = null

  const abandonada = (e: ClockEventLike): JornadaDerivada => ({
    inEventId: e.id,
    inAt: e.at.toISOString(),
    branchId: e.branchId ?? null,
    outEventId: null,
    outAt: null,
    minutos: null,
    open: false,
    openEnded: true,
    longShift: false,
    source: "clock",
  })

  for (const e of sorted) {
    if (e.type === "IN") {
      // Un segundo IN (solo fuera del flujo normal de la API o tras una
      // jornada ya abandonada) cierra la anterior como abandonada.
      if (openIn) jornadas.push(abandonada(openIn))
      openIn = e
      continue
    }
    if (e.type === "OUT") {
      if (!openIn) continue // OUT huérfano: no hay jornada que cerrar.
      const durMs = e.at.getTime() - openIn.at.getTime()
      if (durMs <= JORNADA_MAX_MS) {
        jornadas.push({
          inEventId: openIn.id,
          inAt: openIn.at.toISOString(),
          branchId: openIn.branchId ?? null,
          outEventId: e.id,
          outAt: e.at.toISOString(),
          minutos: Math.max(0, Math.round(durMs / 60000)),
          open: false,
          openEnded: false,
          longShift: false,
          source: "clock",
        })
      } else {
        // >16 h después del IN: checada olvidada — no se cuenta el tiempo.
        jornadas.push(abandonada(openIn))
      }
      openIn = null
    }
    // Cualquier otro `type` (dato corrupto) se ignora.
  }

  if (openIn) {
    const ageMs = now.getTime() - openIn.at.getTime()
    if (ageMs <= JORNADA_MAX_MS) {
      const minutos = Math.max(0, Math.round(ageMs / 60000))
      jornadas.push({
        inEventId: openIn.id,
        inAt: openIn.at.toISOString(),
        branchId: openIn.branchId ?? null,
        outEventId: null,
        outAt: null,
        minutos,
        open: true,
        openEnded: false,
        longShift: minutos >= JORNADA_ALERTA_MIN,
        source: "clock",
      })
    } else {
      jornadas.push(abandonada(openIn))
    }
  }
  return jornadas
}

export interface DiaReloj {
  /** Minutos reales del día-negocio (jornada abandonada aporta 0). */
  minutos: number
  /** Checadas que componen las jornadas del día (INs + sus OUTs reales). */
  eventos: number
  /** Conteo por tipo para el desglose ("IN"/"OUT"). */
  porTipo: Record<string, number>
  /** Primer IN del día (ISO). */
  firstAt: string
  /** Último instante real del día: el mayor entre OUTs e INs (ISO). */
  lastAt: string
  /** Hay una jornada corriendo ahora mismo (IN de este día sin OUT). */
  open: boolean
  /** Al menos una jornada del día quedó abandonada sin minutos reales. */
  openEnded: boolean
}

/**
 * Jornadas → buckets por día-negocio del IN (America/Mexico_City), para UN
 * usuario. `diasDesdeReloj` es la fuente de minutos cuando el empleado usó
 * el checador en el rango (preferida sobre la reconstrucción por actividad).
 */
export function diasDesdeReloj(events: ClockEventLike[], now: Date = new Date()): Map<string, DiaReloj> {
  const jornadas = deriveJornadas(events, now)
  const dias = new Map<string, DiaReloj>()
  for (const j of jornadas) {
    const day = businessDayKey(new Date(j.inAt))
    let d = dias.get(day)
    if (!d) {
      d = { minutos: 0, eventos: 0, porTipo: {}, firstAt: j.inAt, lastAt: j.inAt, open: false, openEnded: false }
      dias.set(day, d)
    }
    d.minutos += j.minutos ?? 0
    d.eventos += 1 // el IN
    d.porTipo.IN = (d.porTipo.IN ?? 0) + 1
    if (j.outAt) {
      d.eventos += 1 // el OUT que cerró (aunque caiga en otro día-negocio)
      d.porTipo.OUT = (d.porTipo.OUT ?? 0) + 1
      if (j.outAt > d.lastAt) d.lastAt = j.outAt
    }
    if (j.inAt < d.firstAt) d.firstAt = j.inAt
    if (j.inAt > d.lastAt) d.lastAt = j.inAt
    if (j.open) d.open = true
    if (j.openEnded) d.openEnded = true
  }
  return dias
}
