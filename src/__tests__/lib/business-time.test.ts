import { describe, expect, it } from "vitest"
import {
  BUSINESS_TIME_ZONE,
  parseBusinessDateParam,
  timeZoneOffsetMs,
  zonedTimeToUtc,
} from "@/lib/business-time"

/**
 * Rangos de reportes en la zona del negocio: una fecha corta "YYYY-MM-DD"
 * es el día completo de America/Mexico_City, no el día UTC del servidor.
 * México ya no usa horario de verano desde 2023 (UTC−6 todo el año), pero
 * las fechas históricas sí conviven con DST y el helper debe resolverlas.
 */

describe("BUSINESS_TIME_ZONE", () => {
  it("es America/Mexico_City", () => {
    expect(BUSINESS_TIME_ZONE).toBe("America/Mexico_City")
  })
})

describe("parseBusinessDateParam — fecha corta", () => {
  it('edge "start" = 00:00:00.000 en México (UTC−6) → 06:00 UTC', () => {
    expect(parseBusinessDateParam("2025-06-15", "start")).toEqual(new Date("2025-06-15T06:00:00.000Z"))
  })

  it('edge "end" = 23:59:59.999 en México → 05:59:59.999 UTC del día siguiente', () => {
    expect(parseBusinessDateParam("2025-06-15", "end")).toEqual(new Date("2025-06-16T05:59:59.999Z"))
  })

  it("un mismo día corto delimita las 24 h locales completas (toca ambos bordes)", () => {
    const start = parseBusinessDateParam("2025-01-31", "start")!
    const end = parseBusinessDateParam("2025-01-31", "end")!
    expect(start.toISOString()).toBe("2025-01-31T06:00:00.000Z")
    expect(end.toISOString()).toBe("2025-02-01T05:59:59.999Z")
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000 - 1)
  })

  it("respeta DST histórico: junio 2021 era UTC−5 (CDT), enero 2021 era UTC−6 (CST)", () => {
    expect(parseBusinessDateParam("2021-06-15", "start")).toEqual(new Date("2021-06-15T05:00:00.000Z"))
    expect(parseBusinessDateParam("2021-01-15", "start")).toEqual(new Date("2021-01-15T06:00:00.000Z"))
  })

  it("funciona en otras zonas: Tokyo (UTC+9) recorre el borde al día UTC anterior", () => {
    expect(parseBusinessDateParam("2025-03-10", "start", "Asia/Tokyo")).toEqual(new Date("2025-03-09T15:00:00.000Z"))
    expect(parseBusinessDateParam("2025-03-10", "end", "Asia/Tokyo")).toEqual(new Date("2025-03-10T14:59:59.999Z"))
  })
})

describe("parseBusinessDateParam — valores que ya traen hora", () => {
  it("un ISO completo se interpreta tal cual, sin re-encuadrar al día", () => {
    expect(parseBusinessDateParam("2025-06-15T10:30:00.000Z", "start")).toEqual(new Date("2025-06-15T10:30:00.000Z"))
    expect(parseBusinessDateParam("2025-06-15T10:30:00.000Z", "end")).toEqual(new Date("2025-06-15T10:30:00.000Z"))
  })

  it("un ISO con offset explícito conserva su instante", () => {
    const iso = "2025-06-15T10:30:00-06:00"
    expect(parseBusinessDateParam(iso, "end")).toEqual(new Date(iso))
  })
})

describe("parseBusinessDateParam — entradas vacías o inválidas", () => {
  it("null, undefined y vacío devuelven null (rango abierto)", () => {
    expect(parseBusinessDateParam(null, "start")).toBeNull()
    expect(parseBusinessDateParam(undefined, "end")).toBeNull()
    expect(parseBusinessDateParam("", "start")).toBeNull()
    expect(parseBusinessDateParam("   ", "end")).toBeNull()
  })

  it("cadenas no-fecha devuelven null en vez de un Date inválido", () => {
    expect(parseBusinessDateParam("ayer", "start")).toBeNull()
    expect(parseBusinessDateParam("15-06-2025", "end")).toBeNull()
  })
})

describe("zonedTimeToUtc / timeZoneOffsetMs", () => {
  it("convierte una hora de pared arbitraria de México a UTC", () => {
    expect(zonedTimeToUtc(2025, 6, 15, 12, 0, 0, 0)).toEqual(new Date("2025-06-15T18:00:00.000Z"))
  })

  it("reporta el desfase correcto del instante (−6 h hoy, −5 h en DST 2021)", () => {
    const sixHours = 6 * 60 * 60 * 1000
    expect(timeZoneOffsetMs(BUSINESS_TIME_ZONE, new Date("2025-06-15T18:00:00Z"))).toBe(-sixHours)
    expect(timeZoneOffsetMs(BUSINESS_TIME_ZONE, new Date("2021-06-15T18:00:00Z"))).toBe(-(5 * 60 * 60 * 1000))
  })
})
