import { describe, expect, it } from "vitest"
import {
  buildConvenioStatement,
  convenioStatementCsv,
  convenioStatementFileName,
  countSettledWithin,
  type ConvenioStatementSourceRow,
} from "@/lib/convenio-statement"

/**
 * Estado de cuenta del convenio por aliado (lib/convenio-statement):
 * partición de cuentas en pendiente/proceso/saldada, totales y el CSV que se
 * descarga para cobrarle al aliado a fin de mes.
 */

const row = (over: Partial<ConvenioStatementSourceRow> = {}): ConvenioStatementSourceRow => ({
  folio: "OT-000001",
  createdAt: "2026-01-05T10:00:00.000Z",
  chargeableAt: "2026-01-08T10:00:00.000Z",
  daysPending: 4,
  partnerPriceCents: 25000,
  convenioSettledAt: null,
  convenioSettledAmountCents: null,
  chargeable: true,
  status: "READY",
  ...over,
})

describe("buildConvenioStatement", () => {
  it("particiona en pendiente/proceso/saldada y suma los totales", () => {
    const st = buildConvenioStatement(
      [
        row({ folio: "OT-1", partnerPriceCents: 25000 }),
        row({ folio: "OT-2", partnerPriceCents: 12000, chargeable: false, chargeableAt: null, daysPending: null, status: "IN_REPAIR" }),
        row({ folio: "OT-3", convenioSettledAt: "2026-01-20T00:00:00.000Z", convenioSettledAmountCents: 25000 }),
      ],
      "Telcel Centro",
      new Date("2026-01-31T18:00:00.000Z"),
    )
    expect(st.allyName).toBe("Telcel Centro")
    expect(st.issuedAt).toBe("2026-01-31T18:00:00.000Z")
    expect(st.pending.map(e => e.folio)).toEqual(["OT-1"])
    expect(st.inProcess.map(e => e.folio)).toEqual(["OT-2"])
    expect(st.settled.map(e => e.folio)).toEqual(["OT-3"])
    expect(st.totalPendingCents).toBe(25000)
    expect(st.totalSettledCents).toBe(25000)
    expect(st.unpricedPending).toBe(0)
  })

  it("ordena pendientes por antigüedad (la más vieja primero)", () => {
    const st = buildConvenioStatement(
      [
        row({ folio: "OT-1", daysPending: 3 }),
        row({ folio: "OT-2", daysPending: 20 }),
        row({ folio: "OT-3", daysPending: null }),
      ],
      "Aliado",
    )
    expect(st.pending.map(e => e.folio)).toEqual(["OT-2", "OT-1", "OT-3"])
  })

  it("la saldada cobra el monto congelado, no el precio convenio vigente", () => {
    const st = buildConvenioStatement(
      [row({ convenioSettledAt: "2026-01-20T00:00:00.000Z", convenioSettledAmountCents: 18000, partnerPriceCents: 30000 })],
      "Aliado",
    )
    // El convenio subió a 300 después de liquidar a 180: el estado muestra 180.
    expect(st.settled[0].amountCents).toBe(18000)
    expect(st.totalSettledCents).toBe(18000)
    // Una saldada legacy sin snapshot cae al precio convenio actual.
    const legacy = buildConvenioStatement(
      [row({ convenioSettledAt: "2026-01-20T00:00:00.000Z", convenioSettledAmountCents: null, partnerPriceCents: 9000 })],
      "Aliado",
    )
    expect(legacy.settled[0].amountCents).toBe(9000)
  })

  it("cuenta aparte las pendientes sin precio convenio", () => {
    const st = buildConvenioStatement(
      [row({ partnerPriceCents: null }), row({ partnerPriceCents: 5000 })],
      "Aliado",
    )
    expect(st.totalPendingCents).toBe(5000)
    expect(st.unpricedPending).toBe(1)
  })
})

describe("convenioStatementCsv", () => {
  it("lleva BOM, encabezados y un renglón por cuenta con su estado", () => {
    const st = buildConvenioStatement(
      [
        row({ folio: "OT-1", partnerPriceCents: 25000 }),
        row({ folio: "OT-2", chargeable: false, chargeableAt: null, daysPending: null, partnerPriceCents: null }),
        row({ folio: "OT-3", convenioSettledAt: "2026-01-20T00:00:00.000Z", convenioSettledAmountCents: 10000 }),
      ],
      "Telcel Centro",
      new Date("2026-01-31T00:00:00.000Z"),
    )
    const csv = convenioStatementCsv(st)
    expect(csv.startsWith("\uFEFF")).toBe(true)
    const lines = csv.slice(1).split("\r\n")
    expect(lines[0]).toBe('"Folio","Recibida","Exigible","Días","Monto","Estado"')
    expect(lines[1]).toBe('"OT-1","2026-01-05","2026-01-08","4","250.00","Pendiente"')
    expect(lines[2]).toBe('"OT-2","2026-01-05","","","","En proceso"')
    expect(lines[3]).toBe('"OT-3","2026-01-05","2026-01-08","","100.00","Saldada"')
    // Renglones de totales al final.
    expect(lines[4]).toBe('"Total pendiente","","","","250.00",""')
    expect(lines[5]).toBe('"Total saldado","","","","100.00",""')
  })

  it("omite el renglón de total saldado cuando no hay saldadas y escapa folios", () => {
    const st = buildConvenioStatement([row({ folio: 'OT "rara", 1' })], "Aliado")
    const lines = convenioStatementCsv(st).slice(1).split("\r\n")
    expect(lines[1]).toBe('"OT ""rara"", 1","2026-01-05","2026-01-08","4","250.00","Pendiente"')
    expect(lines[lines.length - 1]).toBe('"Total pendiente","","","","250.00",""')
    expect(lines.some(l => l.includes("Total saldado"))).toBe(false)
  })
})

describe("convenioStatementFileName", () => {
  it("slugifica el nombre del aliado y anexa la fecha", () => {
    expect(convenioStatementFileName("Telcel Centro", new Date("2026-01-31T12:00:00.000Z")))
      .toBe("estado-cuenta-telcel-centro-2026-01-31.csv")
    expect(convenioStatementFileName("Pólux Reparación!", new Date("2026-02-01T00:00:00.000Z")))
      .toBe("estado-cuenta-polux-reparacion-2026-02-01.csv")
    expect(convenioStatementFileName("  ", new Date("2026-02-01T00:00:00.000Z")))
      .toBe("estado-cuenta-aliado-2026-02-01.csv")
  })
})

describe("countSettledWithin", () => {
  const DAY = 24 * 60 * 60 * 1000
  it("cuenta solo las saldadas dentro de la ventana", () => {
    const now = Date.parse("2026-02-01T00:00:00.000Z")
    const count = countSettledWithin(
      [
        { convenioSettledAt: new Date(now - 2 * DAY) },   // hace 2 días → sí
        { convenioSettledAt: new Date(now - 29 * DAY) },  // hace 29 días → sí
        { convenioSettledAt: new Date(now - 45 * DAY) },  // hace 45 días → no
        { convenioSettledAt: null },                       // pendiente → no
      ],
      30,
      now,
    )
    expect(count).toBe(2)
  })

  it("acepte fechas ISO y una saldada futura (dato raro) cuenta como reciente", () => {
    const now = Date.parse("2026-02-01T00:00:00.000Z")
    expect(countSettledWithin([{ convenioSettledAt: "2026-02-05T00:00:00.000Z" }], 30, now)).toBe(1)
    expect(countSettledWithin([{ convenioSettledAt: "fecha-no-valida" }], 30, now)).toBe(0)
  })
})
