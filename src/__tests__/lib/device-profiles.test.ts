import { describe, it, expect } from "vitest"
import { DEVICE_PROFILES, deviceProfileFor } from "@/lib/device-profiles"

// "Componentes que incluye": chips por perfil que se suman a los accesorios
// recibidos al enviar la orden de recepción.
describe("componentChecklist por tipo de equipo", () => {
  it("Computadora incluye torre y periféricos", () => {
    expect(deviceProfileFor("Computadora").componentChecklist).toEqual([
      "CPU / Torre", "Monitor", "Teclado", "Mouse", "Cables de poder/datos",
    ])
  })

  it("Laptop incluye cargador, dock y mouse", () => {
    expect(deviceProfileFor("Laptop").componentChecklist).toEqual(["Cargador", "Dock", "Mouse"])
  })

  it("los perfiles sin lista no rompen el asistente", () => {
    expect(deviceProfileFor("Celular").componentChecklist).toBeUndefined()
    expect(deviceProfileFor("Tipo que no existe").componentChecklist).toBeUndefined()
    expect(DEVICE_PROFILES.Otro.componentChecklist).toBeUndefined()
  })
})
