import { describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import { changeCash, countsAsCash, denominationsTotalCents, expectedCashCents } from "@/lib/domain/cash"

const BIZ = "biz-cash-test"
const admin = { id: "admin-1", name: "Admin", role: "ADMIN", status: "APPROVED", businessId: BIZ, homeBranchId: null }
const branch = { id: "branch-1", name: "Sucursal 1", isActive: true, businessId: BIZ }
const register = { id: "reg-1", status: "OPEN", openedById: "admin-1", branchId: "branch-1", businessId: BIZ, initialAmount: 100 }
let keySeq = 0
const key = () => `cash-close-key-${++keySeq}`

/**
 * Replica mínima del flujo de operation(): $transaction ejecuta el trabajo con
 * un tx falso que responde lo que changeCash(CLOSE) necesita — actor, sucursal,
 * caja abierta con lock, movimientos y el update final del cierre.
 */
function fakeDb(opts: {
  user?: Record<string, unknown>
  movements?: { type: "IN" | "OUT"; amount: number; payment?: { method: string; amount: number } | null }[]
  openRegisters?: Record<string, unknown>[]
} = {}) {
  const calls: { registerUpdate?: { data: Record<string, unknown> } } = {}
  const tx = {
    user: { findUnique: vi.fn(async () => opts.user ?? admin) },
    branch: { findFirst: vi.fn(async () => branch) },
    cashRegister: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => opts.openRegisters ?? [register]),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "reg-new", ...args.data })),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        calls.registerUpdate = args
        return { ...register, ...args.data, status: "CLOSED", closedAt: new Date() }
      }),
    },
    cashMovement: {
      findMany: vi.fn(async () => opts.movements ?? []),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "mov-new", ...args.data })),
    },
    businessOperation: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "op-1" })),
      update: vi.fn(async () => ({})),
    },
  }
  const db = { $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(tx) }
  return { db: db as unknown as PrismaClient, tx, calls }
}

describe("denominationsTotalCents", () => {
  it("suma el conteo físico en centavos", () => {
    expect(denominationsTotalCents({ "500": 3, "200": 1, "100": 2, "50": 0, "20": 4, "10": 0, "5": 1, "1": 0, "0.5": 0 }))
      .toBe(3 * 50000 + 20000 + 2 * 10000 + 4 * 2000 + 500)
    expect(denominationsTotalCents({})).toBe(0)
    expect(denominationsTotalCents({ "0.5": 3, "1": 2, "2": 1 })).toBe(150 + 200 + 200)
  })
})

describe("countsAsCash / expectedCashCents", () => {
  it("cuenta movimientos sin pago ligado y pagos CASH", () => {
    expect(countsAsCash({ type: "IN", amount: 10, payment: null })).toBe(true)
    expect(countsAsCash({ type: "OUT", amount: 10, payment: null })).toBe(true)
    expect(countsAsCash({ type: "IN", amount: 10, payment: { method: "CASH", amount: 10 } })).toBe(true)
    expect(countsAsCash({ type: "OUT", amount: 10, payment: { method: "CASH", amount: -10 } })).toBe(true)
  })

  it("excluye movimientos ligados a cobros CARD/TRANSFER (no tocan el cajón)", () => {
    expect(countsAsCash({ type: "IN", amount: 10, payment: { method: "CARD", amount: 10 } })).toBe(false)
    expect(countsAsCash({ type: "IN", amount: 10, payment: { method: "TRANSFER", amount: 10 } })).toBe(false)
    expect(countsAsCash({ type: "IN", amount: 10, payment: { method: "CREDIT", amount: 10 } })).toBe(false)
  })

  it("cuenta reembolsos no-CASH porque la devolución sale del cajón", () => {
    // Devolución de abonos ya cobrados (refund CREDITO en sales.ts): el pago es
    // CREDIT pero el movimiento ligado sí sacó billetes de la caja.
    expect(countsAsCash({ type: "OUT", amount: 10, payment: { method: "CREDIT", amount: -10 } })).toBe(true)
    expect(countsAsCash({ type: "OUT", amount: 10, payment: { method: "CARD", amount: -10 } })).toBe(true)
  })

  it("calcula el esperado: inicial + entradas de efectivo − salidas de efectivo", () => {
    const expected = expectedCashCents(100, [
      { type: "IN", amount: 250.5, payment: null },                            // ingreso manual
      { type: "IN", amount: 60, payment: { method: "CASH", amount: 60 } },     // venta efectivo
      { type: "IN", amount: 400, payment: { method: "CARD", amount: 400 } },   // venta tarjeta: NO cuenta
      { type: "IN", amount: 300, payment: { method: "TRANSFER", amount: 300 } }, // transferencia: NO cuenta
      { type: "OUT", amount: 30, payment: null },                              // retiro manual
      { type: "OUT", amount: 20, payment: { method: "CASH", amount: -20 } },   // devolución efectivo
      { type: "OUT", amount: 15, payment: { method: "CREDIT", amount: -15 } }, // devolución de abonos: SÍ sale del cajón
    ])
    // 100 + 250.5 + 60 - 30 - 20 - 15 = 345.5
    expect(expected).toBe(34550)
  })
})

describe("changeCash CLOSE", () => {
  it("deriva finalAmount del desglose y devuelve esperado/diferencia", async () => {
    const { db, calls } = fakeDb({
      movements: [
        { type: "IN", amount: 250.5, payment: null },
        { type: "IN", amount: 60, payment: { method: "CASH", amount: 60 } },
        { type: "IN", amount: 400, payment: { method: "CARD", amount: 400 } }, // no cuenta
        { type: "OUT", amount: 30, payment: null },
      ],
    })
    const result = await changeCash(db, admin.id, BIZ, {
      action: "CLOSE", registerId: "reg-1", branchId: "branch-1",
      denominations: { "500": 1, "100": 1, "20": 3, "0.5": 1 }, // 500 + 100 + 60 + 0.5 = 660.5
      description: "cierre normal", idempotencyKey: key(),
    })
    // Esperado: 100 + 250.5 + 60 - 30 = 380.5
    expect(result.expectedCashCents).toBe(38050)
    expect(result.differenceCents).toBe(66050 - 38050)
    expect(calls.registerUpdate?.data.finalAmount).toBe(660.5)
    expect(calls.registerUpdate?.data.denominations).toEqual({ "500": 1, "100": 1, "20": 3, "0.5": 1 })
    expect(calls.registerUpdate?.data.status).toBe("CLOSED")
    expect(result.register.status).toBe("CLOSED")
  })

  it("mantiene el cierre clásico por monto capturado", async () => {
    const { db, calls } = fakeDb({ movements: [{ type: "IN", amount: 280.5, payment: null }] })
    const result = await changeCash(db, admin.id, BIZ, {
      action: "CLOSE", registerId: "reg-1", branchId: "branch-1",
      amount: 380.5, idempotencyKey: key(),
    })
    expect(result.expectedCashCents).toBe(38050)
    expect(result.differenceCents).toBe(0)
    expect(calls.registerUpdate?.data.finalAmount).toBe(380.5)
    expect(calls.registerUpdate?.data.denominations).toBeUndefined()
  })

  it("reporta faltante cuando el conteo queda debajo del esperado", async () => {
    const { db } = fakeDb({ movements: [{ type: "IN", amount: 500, payment: null }] })
    const result = await changeCash(db, admin.id, BIZ, {
      action: "CLOSE", registerId: "reg-1", branchId: "branch-1",
      denominations: { "500": 1 }, // contado 500 vs esperado 600 → -100
      idempotencyKey: key(),
    })
    expect(result.expectedCashCents).toBe(60000)
    expect(result.differenceCents).toBe(-10000)
  })

  it("rechaza denominaciones fuera de la whitelist sin tocar la base", async () => {
    await expect(changeCash(null as unknown as PrismaClient, admin.id, BIZ, {
      action: "CLOSE", registerId: "reg-1", amount: 750,
      denominations: { "750": 1 }, idempotencyKey: key(),
    })).rejects.toThrow(/Denominación desconocida/)
    await expect(changeCash(null as unknown as PrismaClient, admin.id, BIZ, {
      action: "CLOSE", registerId: "reg-1",
      denominations: { "quinientos": 2 }, idempotencyKey: key(),
    })).rejects.toThrow(/Denominación desconocida/)
    // Piezas negativas o fraccionadas tampoco pasan.
    await expect(changeCash(null as unknown as PrismaClient, admin.id, BIZ, {
      action: "CLOSE", registerId: "reg-1",
      denominations: { "100": -1 }, idempotencyKey: key(),
    })).rejects.toThrow()
    await expect(changeCash(null as unknown as PrismaClient, admin.id, BIZ, {
      action: "CLOSE", registerId: "reg-1",
      denominations: { "100": 1.5 }, idempotencyKey: key(),
    })).rejects.toThrow()
  })

  it("exige el monto cuando el cierre no trae desglose", async () => {
    await expect(changeCash(null as unknown as PrismaClient, admin.id, BIZ, {
      action: "CLOSE", registerId: "reg-1", idempotencyKey: key(),
    })).rejects.toThrow()
    // OPEN y MOVEMENT también siguen exigiendo monto.
    await expect(changeCash(null as unknown as PrismaClient, admin.id, BIZ, {
      action: "OPEN", idempotencyKey: key(),
    })).rejects.toThrow()
  })

  it("permite cerrar a quien abrió la caja aunque no sea admin; rechaza a otro empleado", async () => {
    const employee = { ...admin, id: "emp-1", role: "EMPLOYEE" }
    const own = { ...register, openedById: "emp-1" }
    const ownDb = fakeDb({ user: employee, openRegisters: [own] })
    await expect(changeCash(ownDb.db, "emp-1", BIZ, {
      action: "CLOSE", registerId: "reg-1", branchId: "branch-1", amount: 100, idempotencyKey: key(),
    })).resolves.toMatchObject({ differenceCents: 0 })

    const other = { ...admin, id: "emp-2", role: "EMPLOYEE" }
    const otherDb = fakeDb({ user: other })
    await expect(changeCash(otherDb.db, "emp-2", BIZ, {
      action: "CLOSE", registerId: "reg-1", branchId: "branch-1", amount: 100, idempotencyKey: key(),
    })).rejects.toMatchObject({ status: 403 })
  })
})
