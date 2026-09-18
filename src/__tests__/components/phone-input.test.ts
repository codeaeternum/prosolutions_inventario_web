import { describe, it, expect } from "vitest"
import { parsePhone } from "@/components/admin/taller/phone-input"
import { formatAccessPattern } from "@/lib/utils"

// La búsqueda de clientes por teléfono usa solo los dígitos locales porque
// User.phone está normalizado a 10 dígitos (sin lada ni formato).
describe("parsePhone", () => {
  it("separa lada conocida y devuelve solo dígitos locales", () => {
    expect(parsePhone("+52 6671234")).toEqual({ dial: "+52", local: "6671234" })
    expect(parsePhone("+52 667 123 4567").local).toBe("6671234567")
  })

  it("prefiere la lada más larga (+1809 gana sobre +1)", () => {
    expect(parsePhone("+1809 555 1234").dial).toBe("+1809")
    expect(parsePhone("+1 555 123 4567").dial).toBe("+1")
  })

  it("sin lada conocida devuelve dial null y limpia el número", () => {
    expect(parsePhone("667-123-4567")).toEqual({ dial: null, local: "6671234567" })
    expect(parsePhone("")).toEqual({ dial: null, local: "" })
  })
})

// En el resumen de recepción el patrón se muestra contado 1-9 como lo dibujó
// el cliente, aunque se guarda como índices 0-8.
describe("formatAccessPattern", () => {
  it("convierte índices 0-8 a puntos 1-9", () => {
    expect(formatAccessPattern("0-4-8")).toBe("1-5-9")
    expect(formatAccessPattern("8-4-0-1-2")).toBe("9-5-1-2-3")
  })

  it("devuelve tal cual valores no numéricos", () => {
    expect(formatAccessPattern("abcd")).toBe("abcd")
    expect(formatAccessPattern("1-2-x")).toBe("2-3-x")
  })
})
