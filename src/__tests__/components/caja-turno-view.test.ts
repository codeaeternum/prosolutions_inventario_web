import { describe, it, expect } from "vitest"
import { cajaTurnoView } from "@/app/admin/caja/page"

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
