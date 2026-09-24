import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Bitácora administrativa (lib/audit): diffChanges arma el antes→después y
 * recordAudit escribe el AuditEvent sin lanzar nunca (la auditoría es
 * testigo, no guardián: un fallo de la bitácora no rompe la operación).
 */

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
}))

// recordAudit recibe el cliente por parámetro (prisma o tx); aquí es un fake.
const db = () => ({ auditEvent: { create: mocks.auditCreate } })

import { diffChanges, listText, maskSensitiveChanges, money, recordAudit } from "@/lib/audit"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auditCreate.mockResolvedValue({ id: "audit-1" })
})

describe("diffChanges", () => {
  it("devuelve solo los campos que cambiaron", () => {
    const before = { precio: 500, nombre: "Pantalla", stock: 3 }
    const after = { precio: 450, nombre: "Pantalla", stock: 3 }
    expect(diffChanges(before, after, ["precio", "nombre", "stock"])).toEqual({
      precio: { before: 500, after: 450 },
    })
  })

  it("ignora campos no listados aunque hayan cambiado", () => {
    const before = { precio: 500, interno: "x" }
    const after = { precio: 450, interno: "y" }
    expect(diffChanges(before, after, ["precio"])).toEqual({
      precio: { before: 500, after: 450 },
    })
  })

  it("compara arreglos por contenido (allowedModules)", () => {
    const before = { modulos: ["ventas", "caja"] }
    expect(diffChanges(before, { modulos: ["ventas", "caja"] }, ["modulos"])).toBeNull()
    expect(diffChanges(before, { modulos: ["ventas", "taller"] }, ["modulos"])).toEqual({
      modulos: { before: ["ventas", "caja"], after: ["ventas", "taller"] },
    })
  })

  it("detecta null → valor y valor → null", () => {
    expect(diffChanges({ costo: null }, { costo: 120 }, ["costo"])).toEqual({
      costo: { before: null, after: 120 },
    })
    expect(diffChanges({ slug: "taller-1" }, { slug: null }, ["slug"])).toEqual({
      slug: { before: "taller-1", after: null },
    })
  })

  it("trata undefined como sin valor (equivale a null)", () => {
    expect(diffChanges({ telefono: null }, { telefono: undefined }, ["telefono"])).toBeNull()
    expect(diffChanges({}, { telefono: null }, ["telefono"])).toBeNull()
  })

  it("devuelve null cuando nada cambió", () => {
    const obj = { a: 1, b: "x", c: [1, 2], d: null }
    expect(diffChanges(obj, { ...obj }, ["a", "b", "c", "d"])).toBeNull()
    expect(diffChanges(null, null, ["a"])).toBeNull()
    expect(diffChanges({}, {}, ["a"])).toBeNull()
  })
})

describe("recordAudit", () => {
  const entry = {
    businessId: "biz-1",
    actorId: "user-1",
    action: "PRODUCT_UPDATE",
    entity: "product",
    entityId: "prod-1",
    entityName: "Pantalla iPhone 11",
    summary: "Precio $500.00 → $450.00",
    changes: { precio: { before: 500, after: 450 } },
  }

  it("crea el AuditEvent con los datos dados", async () => {
    await recordAudit(db() as never, entry)
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1)
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: {
        businessId: "biz-1",
        actorId: "user-1",
        action: "PRODUCT_UPDATE",
        entity: "product",
        entityId: "prod-1",
        entityName: "Pantalla iPhone 11",
        summary: "Precio $500.00 → $450.00",
        changes: { precio: { before: 500, after: 450 } },
      },
    })
  })

  it("rellena entityId/entityName con null cuando no llegan", async () => {
    await recordAudit(db() as never, {
      businessId: "biz-1",
      actorId: "user-1",
      action: "SETTINGS_UPDATE",
      entity: "settings",
      summary: "Cambió configuración: order_prefix",
    })
    const data = mocks.auditCreate.mock.calls[0][0].data
    expect(data.entityId).toBeNull()
    expect(data.entityName).toBeNull()
    expect(data.changes).toBeUndefined()
  })

  it("NUNCA lanza: un fallo de la bitácora solo se loguea", async () => {
    mocks.auditCreate.mockRejectedValue(new Error("db caída"))
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    await expect(recordAudit(db() as never, entry)).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe("money y listText", () => {
  it("formatea montos estilo MXN", () => {
    expect(money(500)).toBe("$500.00")
    expect(money(4500)).toBe("$4,500.00")
    expect(money(null)).toBe("—")
    expect(money(undefined)).toBe("—")
    expect(money(NaN)).toBe("—")
  })

  it("resume listas con etiqueta de vacío configurable", () => {
    expect(listText(["ventas", "caja"], "todos")).toBe("[ventas, caja]")
    expect(listText([], "todos")).toBe("todos")
    expect(listText(undefined)).toBe("[]")
  })
})

describe("maskSensitiveChanges", () => {
  it("censura llaves cuyo nombre delata secreto", () => {
    const changes = {
      bank_transfer_info: { before: "a", after: "b" },
      api_secret: { before: "x", after: "y" },
      reset_token: { before: "t1", after: "t2" },
    }
    expect(maskSensitiveChanges(changes)).toEqual({
      bank_transfer_info: { before: "a", after: "b" },
      api_secret: { before: "•••", after: "•••" },
      reset_token: { before: "•••", after: "•••" },
    })
  })

  it("pasa null intacto", () => {
    expect(maskSensitiveChanges(null)).toBeNull()
  })
})
