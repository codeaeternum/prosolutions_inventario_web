import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * GET /api/inventory — historial unificado movimientos + reservas.
 *
 * Se mockean auth() (sesión) y prisma; se ejercita el handler real y se
 * inspeccionan los `where` que llegan a cada findMany/count para verificar:
 * - type=OUT honesto (salidas sin ventas POS: paymentMethod null).
 * - Rango from/to sobre createdAt (movimientos) y updatedAt (reservas),
 *   en la zona del negocio (America/Mexico_City → fechas cortas a UTC−6).
 * - Búsqueda q contains-insensitive en producto/motivo/notas.
 * - Los count() reciben el mismo where filtrado (total consistente).
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  movementFindMany: vi.fn(),
  movementCount: vi.fn(),
  movementAggregate: vi.fn(),
  reservationFindMany: vi.fn(),
  reservationCount: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth, handlers: { GET: vi.fn(), POST: vi.fn() } }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    inventoryMovement: {
      findMany: mocks.movementFindMany,
      count: mocks.movementCount,
      aggregate: mocks.movementAggregate,
    },
    reservation: {
      findMany: mocks.reservationFindMany,
      count: mocks.reservationCount,
    },
  },
}))

import { NextRequest } from "next/server"
import { GET } from "@/app/api/inventory/route"

const session = (id = "u-admin", role = "ADMIN", extra: Record<string, unknown> = {}) => ({
  user: { id, role, status: "APPROVED", businessId: "biz-1", ...extra },
})

const get = (query = "") => GET(new NextRequest(`https://app.invalid/api/inventory${query}`))

const movementWhere = () => mocks.movementFindMany.mock.calls.at(-1)![0].where
const reservationWhere = () => mocks.reservationFindMany.mock.calls.at(-1)![0].where

// 2025-06 es UTC−6 en America/Mexico_City (sin DST desde 2022).
const JUN1_START = new Date("2025-06-01T06:00:00.000Z")
const JUN15_END = new Date("2025-06-16T05:59:59.999Z")

const contains = (q: string) => ({ contains: q, mode: "insensitive" })
const movementSearchOr = (q: string) => [{
  OR: [
    { product: { name: contains(q) } },
    { product: { barcode: contains(q) } },
    { reason: contains(q) },
    { notes: contains(q) },
  ],
}]
const reservationSearchOr = (q: string) => [{
  OR: [
    { product: { name: contains(q) } },
    { product: { barcode: contains(q) } },
    { adminNotes: contains(q) },
  ],
}]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(session())
  mocks.movementFindMany.mockResolvedValue([])
  mocks.movementCount.mockResolvedValue(0)
  mocks.movementAggregate.mockResolvedValue({ _sum: { quantity: 0 } })
  mocks.reservationFindMany.mockResolvedValue([])
  mocks.reservationCount.mockResolvedValue(0)
})

describe("acceso", () => {
  it("rechaza sin sesión, pendientes, clientes y empleados sin el módulo", async () => {
    for (const s of [
      null,
      session("u1", "ADMIN", { status: "PENDING" }),
      session("u2", "CUSTOMER"),
      session("u3", "EMPLOYEE", { allowedModules: ["ventas"] }),
    ]) {
      mocks.auth.mockResolvedValue(s)
      const res = await get("?type=SALE&q=x&from=2025-06-01")
      expect([401, 403]).toContain(res.status)
    }
    expect(mocks.movementFindMany).not.toHaveBeenCalled()
    expect(mocks.reservationFindMany).not.toHaveBeenCalled()
  })

  it("empleado con el módulo inventario sí consulta el historial", async () => {
    mocks.auth.mockResolvedValue(session("u-emp", "EMPLOYEE", { allowedModules: ["inventario"] }))
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ movements: [], total: 0 })
  })
})

describe("filtro type", () => {
  it("type=OUT son salidas honestas: excluye ventas (paymentMethod null) y no consulta reservas", async () => {
    const res = await get("?type=OUT")
    expect(res.status).toBe(200)
    expect(mocks.movementFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: "biz-1", type: "OUT", paymentMethod: null } })
    )
    // El count usa el mismo where para que `total` respete el filtro.
    expect(mocks.movementCount).toHaveBeenCalledWith({ where: { businessId: "biz-1", type: "OUT", paymentMethod: null } })
    expect(mocks.reservationFindMany).not.toHaveBeenCalled()
    expect(mocks.reservationCount).not.toHaveBeenCalled()
  })

  it("type=MERMAS equivale a OUT (misma cláusula, sin prefijo de notes)", async () => {
    await get("?type=MERMAS")
    const where = movementWhere()
    expect(where).toEqual({ businessId: "biz-1", type: "OUT", paymentMethod: null })
    expect(where).not.toHaveProperty("notes")
  })

  it("type=SALE se conserva: OUT con paymentMethod no null + reservas COMPLETED", async () => {
    await get("?type=SALE")
    expect(mocks.movementFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: "biz-1", type: "OUT", paymentMethod: { not: null } } })
    )
    expect(reservationWhere()).toEqual({ businessId: "biz-1", status: "COMPLETED" })
    expect(mocks.reservationCount).toHaveBeenCalledWith({ where: { businessId: "biz-1", status: "COMPLETED" } })
  })

  it("type=DAMAGED agrega el prefijo merma:damaged en notes", async () => {
    await get("?type=DAMAGED")
    expect(movementWhere()).toEqual({
      businessId: "biz-1",
      type: "OUT",
      paymentMethod: null,
      notes: { startsWith: "merma:damaged" },
    })
  })

  it("type=CANCELLED solo consulta reservas canceladas", async () => {
    await get("?type=CANCELLED")
    expect(mocks.movementFindMany).not.toHaveBeenCalled()
    expect(mocks.movementCount).not.toHaveBeenCalled()
    expect(reservationWhere()).toEqual({ businessId: "biz-1", status: "CANCELLED" })
  })

  it("sin type mezcla movimientos y reservas COMPLETED+CANCELLED", async () => {
    await get()
    expect(movementWhere()).toEqual({ businessId: "biz-1" })
    expect(reservationWhere()).toEqual({ businessId: "biz-1", status: { in: ["COMPLETED", "CANCELLED"] } })
  })
})

describe("rango de fechas from/to", () => {
  it("fecha corta cubre el día completo del negocio: createdAt en movimientos, updatedAt en reservas", async () => {
    await get("?from=2025-06-01&to=2025-06-15")
    const expected = { gte: JUN1_START, lte: JUN15_END }
    expect(movementWhere()).toEqual({ businessId: "biz-1", createdAt: expected })
    expect(reservationWhere()).toEqual({
      businessId: "biz-1",
      status: { in: ["COMPLETED", "CANCELLED"] },
      updatedAt: expected,
    })
    expect(mocks.movementCount).toHaveBeenCalledWith({ where: { businessId: "biz-1", createdAt: expected } })
    expect(mocks.reservationCount).toHaveBeenCalledWith({
      where: { businessId: "biz-1", status: { in: ["COMPLETED", "CANCELLED"] }, updatedAt: expected },
    })
  })

  it("cada punta es independiente: solo from → gte sin lte; solo to → lte sin gte", async () => {
    await get("?from=2025-06-01")
    expect(movementWhere().createdAt).toEqual({ gte: JUN1_START })
    expect(reservationWhere().updatedAt).toEqual({ gte: JUN1_START })

    vi.clearAllMocks()
    mocks.auth.mockResolvedValue(session())
    mocks.movementFindMany.mockResolvedValue([])
    mocks.movementCount.mockResolvedValue(0)
    mocks.movementAggregate.mockResolvedValue({ _sum: { quantity: 0 } })
    mocks.reservationFindMany.mockResolvedValue([])
    mocks.reservationCount.mockResolvedValue(0)

    await get("?to=2025-06-15")
    expect(movementWhere().createdAt).toEqual({ lte: JUN15_END })
    expect(reservationWhere().updatedAt).toEqual({ lte: JUN15_END })
  })

  it("un ISO con hora pasa tal cual, sin re-encuadrar al día", async () => {
    await get("?from=2025-06-15T10:30:00.000Z&to=2025-06-15T18:00:00.000Z")
    expect(movementWhere().createdAt).toEqual({
      gte: new Date("2025-06-15T10:30:00.000Z"),
      lte: new Date("2025-06-15T18:00:00.000Z"),
    })
  })

  it.each([
    ["from", "?from=ayer"],
    ["to", "?to=15-06-2025"],
    ["from junto a to válido", "?from=no-es-fecha&to=2025-06-15"],
  ])("400 cuando %s es inválido", async (_label, query) => {
    const res = await get(query)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: expect.any(String) })
    expect(mocks.movementFindMany).not.toHaveBeenCalled()
    expect(mocks.reservationFindMany).not.toHaveBeenCalled()
  })

  it("sin from/to no hay filtro de fecha", async () => {
    await get()
    expect(movementWhere()).not.toHaveProperty("createdAt")
    expect(reservationWhere()).not.toHaveProperty("updatedAt")
  })
})

describe("búsqueda q", () => {
  it("construye OR contains-insensitive en producto, motivo y notas (AND-ed)", async () => {
    await get("?q=pantalla")
    expect(movementWhere()).toEqual({ businessId: "biz-1", AND: movementSearchOr("pantalla") })
    expect(reservationWhere()).toEqual({
      businessId: "biz-1",
      status: { in: ["COMPLETED", "CANCELLED"] },
      AND: reservationSearchOr("pantalla"),
    })
    // Los counts comparten el where para que `total` respete la búsqueda.
    expect(mocks.movementCount).toHaveBeenCalledWith({ where: movementWhere() })
    expect(mocks.reservationCount).toHaveBeenCalledWith({ where: reservationWhere() })
  })

  it("recorta espacios y un q vacío no agrega filtro", async () => {
    await get("?q=%20%20%20")
    expect(movementWhere()).not.toHaveProperty("AND")
    expect(reservationWhere()).not.toHaveProperty("AND")

    await get(`?q=${encodeURIComponent("  filtro  ")}`)
    expect(movementWhere().AND).toEqual(movementSearchOr("filtro"))
  })

  it("tope de 100 caracteres", async () => {
    const largo = "x".repeat(150)
    await get(`?q=${largo}`)
    const or = movementWhere().AND[0].OR
    expect(or[0].product.name.contains).toBe("x".repeat(100))
  })
})

describe("composición de filtros", () => {
  it("type + q + fechas + productId conviven en el mismo where", async () => {
    await get("?type=SALE&q=mica&from=2025-06-01&to=2025-06-15&productId=p1")
    expect(movementWhere()).toEqual({
      businessId: "biz-1",
      productId: "p1",
      type: "OUT",
      paymentMethod: { not: null },
      createdAt: { gte: JUN1_START, lte: JUN15_END },
      AND: movementSearchOr("mica"),
    })
    expect(reservationWhere()).toEqual({
      businessId: "biz-1",
      status: "COMPLETED",
      productId: "p1",
      updatedAt: { gte: JUN1_START, lte: JUN15_END },
      AND: reservationSearchOr("mica"),
    })
  })

  it("type=CANCELLED ignora movimientos pero aplica q y fechas a las reservas", async () => {
    await get("?type=CANCELLED&q=nota&from=2025-06-01")
    expect(mocks.movementFindMany).not.toHaveBeenCalled()
    expect(reservationWhere()).toEqual({
      businessId: "biz-1",
      status: "CANCELLED",
      updatedAt: { gte: JUN1_START },
      AND: reservationSearchOr("nota"),
    })
  })
})

describe("merge, orden y enriquecimiento", () => {
  it("fusiona movimientos y reservas ordenadas desc y calcula returnableQuantity", async () => {
    mocks.movementFindMany.mockResolvedValue([{
      id: "m1",
      type: "OUT",
      paymentMethod: "CASH",
      quantity: 3,
      createdAt: new Date("2025-06-10T12:00:00Z"),
      product: { id: "p1", name: "Pantalla", barcode: "123", costPrice: 50 },
      user: { id: "u1", name: "Emp", role: "EMPLOYEE" },
    }])
    mocks.reservationFindMany.mockResolvedValue([{
      id: "r1",
      status: "COMPLETED",
      quantity: 2,
      totalPrice: 200,
      updatedAt: new Date("2025-06-11T12:00:00Z"),
      product: { id: "p2", name: "Batería", barcode: "456" },
      user: { id: "u2", name: "Cli", role: "CUSTOMER" },
      adminNotes: "entregada",
    }])
    mocks.movementCount.mockResolvedValue(1)
    mocks.reservationCount.mockResolvedValue(1)
    mocks.movementAggregate.mockResolvedValue({ _sum: { quantity: 1 } })

    const res = await get()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(2)
    expect(body.movements).toHaveLength(2)
    // Reserva más reciente primero; COMPLETED → SALE con source RESERVATION.
    expect(body.movements[0]).toMatchObject({
      id: "r1", type: "SALE", source: "RESERVATION", quantity: 2,
      totalPrice: 200, unitPrice: 100, notes: "entregada", returnableQuantity: 1,
    })
    // OUT con paymentMethod se reetiqueta como SALE; returnable = qty − devueltos.
    expect(body.movements[1]).toMatchObject({
      id: "m1", type: "SALE", source: "MOVEMENT", quantity: 3, returnableQuantity: 2,
    })
    // El aggregate de devueltas apunta al id correcto según el origen.
    expect(mocks.movementAggregate).toHaveBeenCalledWith({
      where: { businessId: "biz-1", type: "RETURN", reservationId: "r1" },
      _sum: { quantity: true },
    })
    expect(mocks.movementAggregate).toHaveBeenCalledWith({
      where: { businessId: "biz-1", type: "RETURN", relatedId: "m1" },
      _sum: { quantity: true },
    })
  })

  it("el total suma movimientos + reservas bajo los filtros aplicados", async () => {
    mocks.movementCount.mockResolvedValue(7)
    mocks.reservationCount.mockResolvedValue(3)
    const res = await get("?q=x&from=2025-06-01")
    expect((await res.json()).total).toBe(10)
  })
})
