import { beforeEach, describe, expect, it, vi } from "vitest"
import { checkStaleRegisters, STALE_REGISTER_NOTIFICATION_TYPE, type StaleRegisterDb } from "@/lib/caja-stale"

/**
 * checkStaleRegisters — alerta de cajas olvidadas (>48 h OPEN):
 *
 * - Sin cajas viejas no consulta ni crea notificaciones.
 * - Una caja vieja genera UNA Notification "stale_register" por día
 *   (dedup por data.registerId + createdAt del día), audience STAFF, con el
 *   nombre de la sucursal en el mensaje.
 * - Un segundo barrido el mismo día deduplica; el del día siguiente vuelve a
 *   notificar (el olvido continúa).
 */

const mocks = vi.hoisted(() => ({
  registerFindMany: vi.fn(),
  notificationFindFirst: vi.fn(),
  notificationCreate: vi.fn(),
}))

// @/lib/prisma exige DATABASE_URL al importar; el barrido corre sobre los
// delegates mockeados (mismo shape que el PrismaClient real).
vi.mock("@/lib/prisma", () => ({
  prisma: {
    cashRegister: { findMany: mocks.registerFindMany },
    notification: { findFirst: mocks.notificationFindFirst, create: mocks.notificationCreate },
  },
}))

const db = {
  cashRegister: { findMany: mocks.registerFindMany },
  notification: { findFirst: mocks.notificationFindFirst, create: mocks.notificationCreate },
} as unknown as StaleRegisterDb

const NOW = new Date("2026-03-10T18:00:00Z")

const staleRegister = (over: Record<string, unknown> = {}) => ({
  id: "reg-1",
  businessId: "biz-1",
  status: "OPEN",
  // 60 h abierta → 2 días completos y sigue.
  openedAt: new Date(NOW.getTime() - 60 * 60 * 60 * 1000),
  branch: { name: "Matriz" },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.registerFindMany.mockResolvedValue([])
  mocks.notificationFindFirst.mockResolvedValue(null)
  mocks.notificationCreate.mockResolvedValue({ id: "n-1" })
})

describe("checkStaleRegisters", () => {
  it("sin cajas viejas no consulta ni crea notificaciones", async () => {
    const result = await checkStaleRegisters("biz-1", db, NOW)

    expect(result).toEqual({ scanned: 0, notified: 0, deduped: 0 })
    expect(mocks.notificationFindFirst).not.toHaveBeenCalled()
    expect(mocks.notificationCreate).not.toHaveBeenCalled()
  })

  it("el barrido solo mira OPEN con >48 h, acotado al tenant", async () => {
    await checkStaleRegisters("biz-1", db, NOW)

    const where = mocks.registerFindMany.mock.calls[0][0].where
    expect(where.businessId).toBe("biz-1")
    expect(where.status).toBe("OPEN")
    expect(where.openedAt.lt).toEqual(new Date(NOW.getTime() - 48 * 60 * 60 * 1000))
  })

  it("una caja vieja genera una Notification stale_register con su sucursal y días", async () => {
    mocks.registerFindMany.mockResolvedValue([staleRegister()])

    const result = await checkStaleRegisters("biz-1", db, NOW)

    expect(result).toEqual({ scanned: 1, notified: 1, deduped: 0 })
    const data = mocks.notificationCreate.mock.calls[0][0].data
    expect(data).toMatchObject({
      businessId: "biz-1",
      type: STALE_REGISTER_NOTIFICATION_TYPE,
      audience: "STAFF",
      data: expect.objectContaining({ registerId: "reg-1" }),
    })
    expect(data.message).toBe("La caja de Matriz lleva 2 días abierta — ¿olvidaste cerrarla?")
  })

  it("una caja sin sucursal asignada dice 'sucursal sin asignar'", async () => {
    mocks.registerFindMany.mockResolvedValue([staleRegister({ branch: null })])

    await checkStaleRegisters("biz-1", db, NOW)

    expect(mocks.notificationCreate.mock.calls[0][0].data.message)
      .toBe("La caja de sucursal sin asignar lleva 2 días abierta — ¿olvidaste cerrarla?")
  })

  it("segundo barrido el mismo día deduplica (una sola alerta por día por caja)", async () => {
    mocks.registerFindMany.mockResolvedValue([staleRegister()])
    // La segunda pasada encuentra la notificación de la primera.
    mocks.notificationFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "n-1" })

    await checkStaleRegisters("biz-1", db, NOW)
    await checkStaleRegisters("biz-1", db, NOW)

    expect(mocks.notificationCreate).toHaveBeenCalledTimes(1)
    // La dedup consulta por data.registerId dentro del día vigente.
    const dedupWhere = mocks.notificationFindFirst.mock.calls[1][0].where
    expect(dedupWhere.type).toBe(STALE_REGISTER_NOTIFICATION_TYPE)
    expect(dedupWhere.data).toEqual({ path: ["registerId"], equals: "reg-1" })
  })

  it("al día siguiente vuelve a notificar la misma caja", async () => {
    mocks.registerFindMany.mockResolvedValue([staleRegister()])
    // Día 1: sin dedup. Día 2: la notificación de ayer quedó fuera del
    // createdAt del día → findFirst no la encuentra y se crea otra.
    mocks.notificationFindFirst.mockResolvedValue(null)

    await checkStaleRegisters("biz-1", db, NOW)
    await checkStaleRegisters("biz-1", db, new Date(NOW.getTime() + 24 * 60 * 60 * 1000))

    expect(mocks.notificationCreate).toHaveBeenCalledTimes(2)
    // Los días del mensaje crecen con el olvido (60 h + 24 h = 3 días).
    expect(mocks.notificationCreate.mock.calls[1][0].data.message).toContain("3 días")
  })

  it("una caja vieja no detiene a las demás aunque su notificación falle", async () => {
    mocks.registerFindMany.mockResolvedValue([
      staleRegister({ id: "reg-1" }),
      staleRegister({ id: "reg-2", branch: { name: "Norte" } }),
    ])
    mocks.notificationCreate
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce({ id: "n-2" })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const result = await checkStaleRegisters("biz-1", db, NOW)

    expect(result.notified).toBe(1)
    expect(mocks.notificationCreate).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})
