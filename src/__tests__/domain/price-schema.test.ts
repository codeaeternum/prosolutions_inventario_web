import { describe, expect, it } from "vitest"
import { isPriceValue, priceSchema, PRICE_MAX, createProductSchema } from "@/lib/domain/products"

/**
 * priceSchema / isPriceValue — la regla ÚNICA de precio del catálogo:
 * ≥ 0, ≤ PRICE_MAX y MÁXIMO dos decimales. cents() (dominio de cobro)
 * rechaza 3+ decimales en cada checkout; el schema lo bloquea en TODAS las
 * entradas (alta, edición, ajuste masivo, Excel y bot).
 */
describe("priceSchema", () => {
  it("acepta enteros, decimales de 1-2 dígitos y strings numéricos", () => {
    for (const ok of [0, 1, 19.9, 19.99, 0.01, 150, "250", "19.99", PRICE_MAX]) {
      const r = priceSchema().safeParse(ok)
      expect(r.success, JSON.stringify(ok)).toBe(true)
    }
  })

  it("rechaza un tercer decimal (el bug: 19.999 dejaba la pieza incobrable)", () => {
    for (const bad of [19.999, 0.001, 1.005, "33.333"]) {
      const r = priceSchema("Precio al público").safeParse(bad)
      expect(r.success, JSON.stringify(bad)).toBe(false)
      if (!r.success) {
        expect(r.error.issues[0].message).toContain("máximo dos decimales")
        expect(r.error.issues[0].message).toContain("Precio al público")
      }
    }
  })

  it("rechaza negativos, no-números, NaN y valores sobre el tope", () => {
    for (const bad of [-1, -0.01, "abc", NaN, Infinity, PRICE_MAX + 0.01, 1_000_000_000]) {
      expect(priceSchema().safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it("la tolerancia no confunde floats legítimos (19.99*100 flota a …998)", () => {
    // 19.99 * 100 === 1998.9999999999998: una comparación exacta contra
    // Math.round rechazaría el precio correcto más común del catálogo.
    expect(19.99 * 100).not.toBe(1999)
    expect(priceSchema().safeParse(19.99).success).toBe(true)
    expect(isPriceValue(19.99)).toBe(true)
  })
})

describe("isPriceValue", () => {
  it("es la misma regla sin envoltura zod (PUT /api/products/[id], Excel)", () => {
    expect(isPriceValue(0)).toBe(true)
    expect(isPriceValue(19.99)).toBe(true)
    expect(isPriceValue(19.999)).toBe(false)
    expect(isPriceValue(-5)).toBe(false)
    expect(isPriceValue(NaN)).toBe(false)
    expect(isPriceValue(Infinity)).toBe(false)
    expect(isPriceValue(PRICE_MAX)).toBe(true)
    expect(isPriceValue(PRICE_MAX + 1)).toBe(false)
  })
})

describe("createProductSchema (entrada del bot/dominio)", () => {
  const base = { name: "Pila", categoryId: "c1", retailPrice: 10, wholesalePrice: 8 }

  it("aplica la misma regla de decimales también en el alta por dominio", () => {
    expect(createProductSchema.safeParse(base).success).toBe(true)
    const bad = createProductSchema.safeParse({ ...base, retailPrice: 10.555 })
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.error.issues[0].message).toContain("máximo dos decimales")
    }
  })
})
