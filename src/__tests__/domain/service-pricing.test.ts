import { describe, expect, it } from "vitest"
import {
  normalizeServicePrices,
  priceScopeKey,
  resolveServicePrice,
  servicePriceInputSchema,
  servicePricesSchema,
} from "@/lib/service-pricing"

// Precio de servicio por dispositivo: fila con modelo exacto > fila con
// tipo de equipo > priceCents base. null final = "se cotiza al recibir".

const modelRow = (deviceModelId: string, priceCents: number) => ({ deviceModelId, equipmentType: null, priceCents })
const typeRow = (equipmentType: string, priceCents: number) => ({ deviceModelId: null, equipmentType, priceCents })

describe("resolveServicePrice", () => {
  const service = { priceCents: 50000, prices: [modelRow("m1", 90000), typeRow("Celular", 70000)] }

  it("el modelo exacto gana sobre el tipo y sobre el precio base", () => {
    expect(resolveServicePrice(service, { deviceModelId: "m1", equipmentType: "Celular" })).toBe(90000)
    expect(resolveServicePrice(service, { deviceModelId: "m1" })).toBe(90000)
  })

  it("el tipo de equipo gana sobre la base cuando el modelo no tiene fila", () => {
    expect(resolveServicePrice(service, { deviceModelId: "otro", equipmentType: "Celular" })).toBe(70000)
    expect(resolveServicePrice(service, { equipmentType: "Celular" })).toBe(70000)
  })

  it("sin fila que aplique cae al precio base", () => {
    expect(resolveServicePrice(service, { deviceModelId: "otro", equipmentType: "Consola" })).toBe(50000)
    expect(resolveServicePrice(service, {})).toBe(50000)
  })

  it("sin precio base ni filas devuelve null (se cotiza al recibir)", () => {
    const variable = { priceCents: null, prices: [modelRow("m1", 90000)] }
    expect(resolveServicePrice(variable, { deviceModelId: "otro", equipmentType: "Celular" })).toBeNull()
    expect(resolveServicePrice({ priceCents: null }, { deviceModelId: "m1" })).toBeNull()
  })

  it("un ctx sin deviceModelId ignora las filas de modelo", () => {
    expect(resolveServicePrice(service, { deviceModelId: null, equipmentType: "Celular" })).toBe(70000)
    expect(resolveServicePrice({ priceCents: 50000, prices: [modelRow("m1", 90000)] }, { equipmentType: "Consola" })).toBe(50000)
  })

  it("equipmentType es match exacto (misma regla que el índice único de la BD)", () => {
    expect(resolveServicePrice(service, { equipmentType: "celular" })).toBe(50000) // case-sensitive
    expect(resolveServicePrice(service, { equipmentType: " Celular" })).toBe(50000)
  })

  it("prices omitido equivale a lista vacía", () => {
    expect(resolveServicePrice({ priceCents: 50000 }, { deviceModelId: "m1", equipmentType: "Celular" })).toBe(50000)
  })
})

describe("normalizeServicePrices", () => {
  it("dedup por alcance: si se repite el alcance gana la última fila", () => {
    const rows = normalizeServicePrices([
      { deviceModelId: "m1", priceCents: 100 },
      { deviceModelId: "m1", priceCents: 200 },
      { equipmentType: "Celular", priceCents: 300 },
      { equipmentType: "Celular", priceCents: 400 },
    ])
    expect(rows).toEqual([modelRow("m1", 200), typeRow("Celular", 400)])
  })

  it("modelo y tipo son alcances distintos aunque el texto coincida", () => {
    const rows = normalizeServicePrices([{ deviceModelId: "Celular", priceCents: 100 }, { equipmentType: "Celular", priceCents: 200 }])
    expect(rows).toHaveLength(2)
    expect(priceScopeKey({ deviceModelId: "x", equipmentType: null })).not.toBe(priceScopeKey({ deviceModelId: null, equipmentType: "x" }))
  })

  it("null/undefined en los alcances normalizan a null", () => {
    const rows = normalizeServicePrices([{ deviceModelId: null, equipmentType: "Laptop", priceCents: 100 }])
    expect(rows[0]).toEqual({ deviceModelId: null, equipmentType: "Laptop", priceCents: 100 })
  })

  it("lista vacía → lista vacía", () => {
    expect(normalizeServicePrices([])).toEqual([])
  })
})

describe("servicePriceInputSchema", () => {
  it("exige exactamente un alcance: ni ambos ni ninguno", () => {
    expect(servicePriceInputSchema.safeParse({ deviceModelId: "m1", equipmentType: "Celular", priceCents: 100 }).success).toBe(false)
    expect(servicePriceInputSchema.safeParse({ priceCents: 100 }).success).toBe(false)
    expect(servicePriceInputSchema.safeParse({ deviceModelId: null, equipmentType: null, priceCents: 100 }).success).toBe(false)
  })

  it("acepta cada alcance por separado y nulls explícitos", () => {
    expect(servicePriceInputSchema.safeParse({ deviceModelId: "m1", priceCents: 100 }).success).toBe(true)
    expect(servicePriceInputSchema.safeParse({ deviceModelId: "m1", equipmentType: null, priceCents: 100 }).success).toBe(true)
    expect(servicePriceInputSchema.safeParse({ equipmentType: "Celular", priceCents: 0 }).success).toBe(true)
  })

  it("priceCents: entero entre 0 y 100000000", () => {
    for (const bad of [-1, 100000001, 10.5, "100"]) {
      expect(servicePriceInputSchema.safeParse({ equipmentType: "Celular", priceCents: bad }).success).toBe(false)
    }
    expect(servicePriceInputSchema.safeParse({ equipmentType: "Celular", priceCents: 100000000 }).success).toBe(true)
  })

  it("alcances vacíos o gigantes se rechazan", () => {
    expect(servicePriceInputSchema.safeParse({ equipmentType: "", priceCents: 100 }).success).toBe(false)
    expect(servicePriceInputSchema.safeParse({ equipmentType: "x".repeat(81), priceCents: 100 }).success).toBe(false)
    expect(servicePriceInputSchema.safeParse({ deviceModelId: "", priceCents: 100 }).success).toBe(false)
  })

  it("el arreglo tiene tope de 200 filas", () => {
    const rows = Array.from({ length: 201 }, () => ({ equipmentType: "Celular", priceCents: 100 }))
    expect(servicePricesSchema.safeParse(rows).success).toBe(false)
  })
})
