import { describe, it, expect } from "vitest"
import { cajaCloseNeedsDiffConfirm, cajaTurnoView } from "@/app/admin/caja/page"

// El tab «Turno actual» decide entre spinner, tarjeta de error, formulario
// de apertura y vista de turno. La regla crítica: un fallo de carga SIN
// datos previos muestra error + reintento — antes renderizaba "Abrir caja"
// como si no hubiera turno y el empleado podía intentar abrir uno ya abierto.

describe("cajaTurnoView", () => {
  it("loading tiene prioridad sobre el resto", () => {
    expect(cajaTurnoView({ loading: true, loadError: false, hasRegister: false })).toBe("loading")
    expect(cajaTurnoView({ loading: true, loadError: true, hasRegister: true })).toBe("loading")
  })

  it("error solo alcanza cuando ya no está cargando", () => {
    expect(cajaTurnoView({ loading: false, loadError: true, hasRegister: false })).toBe("error")
    expect(cajaTurnoView({ loading: false, loadError: true, hasRegister: true })).toBe("error")
  })

  it("sin error: register abierto → open, sin register → closed (formulario de apertura)", () => {
    expect(cajaTurnoView({ loading: false, loadError: false, hasRegister: true })).toBe("open")
    expect(cajaTurnoView({ loading: false, loadError: false, hasRegister: false })).toBe("closed")
  })
})

// Umbral de la confirmación explícita del cierre: |diff| > $500 o > 20% del
// esperado. El corte es irreversible — un descuadre grande no debe pasar con
// un solo click, pero tampoco se puede molestar por errores menores de conteo.
describe("cajaCloseNeedsDiffConfirm", () => {
  it("cuadrada o errores menores de conteo no piden confirmación", () => {
    expect(cajaCloseNeedsDiffConfirm(0, 300_000)).toBe(false)
    expect(cajaCloseNeedsDiffConfirm(5_000, 300_000)).toBe(false) // $50 sobre $3,000 (1.7%)
    expect(cajaCloseNeedsDiffConfirm(-5_000, 300_000)).toBe(false)
  })

  it("el umbral absoluto es ESTRICTAMENTE mayor a $500, en cualquier signo", () => {
    expect(cajaCloseNeedsDiffConfirm(50_000, 300_000)).toBe(false) // exactamente $500 no
    expect(cajaCloseNeedsDiffConfirm(50_001, 300_000)).toBe(true)
    expect(cajaCloseNeedsDiffConfirm(-50_001, 300_000)).toBe(true)
  })

  it("el 20% del esperado también dispara aunque no llegue a $500", () => {
    expect(cajaCloseNeedsDiffConfirm(-3_000, 10_000)).toBe(true) // $30 sobre $100 = 30%
    expect(cajaCloseNeedsDiffConfirm(2_000, 10_000)).toBe(false) // exactamente 20% no
    expect(cajaCloseNeedsDiffConfirm(2_001, 10_000)).toBe(true)
  })

  it("con esperado $0 solo manda el absoluto (sin porcentaje)", () => {
    expect(cajaCloseNeedsDiffConfirm(100, 0)).toBe(false)
    expect(cajaCloseNeedsDiffConfirm(50_001, 0)).toBe(true)
  })
})
