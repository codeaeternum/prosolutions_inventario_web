import { describe, it, expect } from "vitest"
import { DIAL_CODE_OPTIONS, KNOWN_DIAL_CODES, OTHER_DIAL_VALUE, parsePhone } from "@/components/admin/taller/phone-input"

// El picker solo ofrece las ladas frecuentes del negocio; EE.UU. y Canadá
// comparten "+1" y se distinguen por el value de la opción, no por el código.
describe("picker de ladas reducido", () => {
  it("ofrece solo México, EE.UU. y Canadá", () => {
    expect(DIAL_CODE_OPTIONS.map(option => option.value)).toEqual(["+52", "+1:US", "+1:CA"])
    expect(DIAL_CODE_OPTIONS.filter(option => option.dial === "+1")).toHaveLength(2)
  })

  it("mantiene el catálogo histórico completo para parsear teléfonos guardados", () => {
    expect(KNOWN_DIAL_CODES).toHaveLength(21)
    expect(KNOWN_DIAL_CODES.map(option => option.code)).toContain("+34")
  })

  it("tiene un value sentinela para la opción libre", () => {
    expect(OTHER_DIAL_VALUE).toBeTruthy()
    expect(DIAL_CODE_OPTIONS.some(option => option.value === OTHER_DIAL_VALUE)).toBe(false)
  })
})

describe("parsePhone con ladas fuera del picker", () => {
  it("sigue reconociendo ladas históricas ya guardadas", () => {
    expect(parsePhone("+34 600 123 456")).toEqual({ dial: "+34", local: "600123456" })
    expect(parsePhone("+57 300 1234567").dial).toBe("+57")
    expect(parsePhone("+502 1234 5678").dial).toBe("+502")
  })

  it("conserva el prefijo +XX desconocido como lada en vez de mezclarlo al número", () => {
    // Lada tecleada en la opción "Otro" o guardada antes de recortar el picker.
    expect(parsePhone("+44 7911 123456")).toEqual({ dial: "+44", local: "7911123456" })
    // Lada a medio teclear ("+" aún sin dígitos) no se confunde con el número.
    expect(parsePhone("+ 6671234567")).toEqual({ dial: null, local: "6671234567" })
    expect(parsePhone("+4 6671234567")).toEqual({ dial: "+4", local: "6671234567" })
  })

  it("un + seguido de puros dígitos sin separador se trata como número local", () => {
    expect(parsePhone("+447911123456")).toEqual({ dial: null, local: "447911123456" })
  })
})
