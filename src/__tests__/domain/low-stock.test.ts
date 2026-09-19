import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import { collectLowStockIds, syncLowStockAlerts } from "@/lib/low-stock"

/**
 * Reglas del aviso de stock bajo. Corre post-commit sobre el PrismaClient real
 * (aquí un doble): los asserts verifican cuándo se marca/limpia
 * lowStockAlertAt y cuándo salen los avisos SSE/Telegram.
 */

const notified = vi.hoisted(() => ({
  staff: vi.fn(async () => {}),
  telegram: vi.fn(async () => 0),
}))
vi.mock("@/app/api/notifications/stream/route", () => ({
  sendNotificationToStaff: notified.staff,
  sendNotificationToAdmins: vi.fn(async () => {}),
}))
vi.mock("@/lib/telegram", () => ({ sendTelegramToUsers: notified.telegram }))

const product = { findMany: vi.fn(), update: vi.fn() }
const db = { product } as unknown as PrismaClient

const row = (over: Record<string, unknown> = {}) => ({
  id: "p1", name: "Pantalla iPhone 13", stock: 2, minStock: 5, lowStockAlertAt: null, ...over,
})
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600_000)

beforeEach(() => {
  vi.clearAllMocks()
  product.findMany.mockResolvedValue([])
  product.update.mockResolvedValue({})
})

describe("alerta al cruzar el umbral", () => {
  it("marca lowStockAlertAt y notifica por SSE al staff y Telegram a admins", async () => {
    product.findMany.mockResolvedValue([row()])
    await syncLowStockAlerts(db, "biz", ["p1"])
    expect(product.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["p1"] }, businessId: "biz", isActive: true },
      select: { id: true, name: true, stock: true, minStock: true, lowStockAlertAt: true },
    })
    expect(product.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { lowStockAlertAt: expect.any(Date) },
    })
    expect(notified.staff).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "low_stock",
        title: "Stock bajo",
        message: expect.stringContaining("Pantalla iPhone 13"),
        data: { products: [{ id: "p1", name: "Pantalla iPhone 13", stock: 2, minStock: 5 }] },
      }),
      "biz",
    )
    expect(notified.telegram).toHaveBeenCalledWith(
      "biz",
      expect.stringContaining("Pantalla iPhone 13: quedan 2 (mín 5)"),
      { role: "ADMIN" },
    )
  })

  it("vuelve a avisar cuando el último aviso tiene más de 24 horas", async () => {
    product.findMany.mockResolvedValue([row({ lowStockAlertAt: hoursAgo(25) })])
    await syncLowStockAlerts(db, "biz", ["p1"])
    expect(product.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { lowStockAlertAt: expect.any(Date) },
    })
    expect(notified.staff).toHaveBeenCalledTimes(1)
    expect(notified.telegram).toHaveBeenCalledTimes(1)
  })
})

describe("anti-spam", () => {
  it("no alerta si el aviso tiene menos de 24 horas", async () => {
    product.findMany.mockResolvedValue([row({ lowStockAlertAt: hoursAgo(2) })])
    await syncLowStockAlerts(db, "biz", ["p1"])
    expect(product.update).not.toHaveBeenCalled()
    expect(notified.staff).not.toHaveBeenCalled()
    expect(notified.telegram).not.toHaveBeenCalled()
  })
})

describe("rearme al reponer stock", () => {
  it("limpia el flag cuando el stock vuelve a quedar por encima del mínimo", async () => {
    product.findMany.mockResolvedValue([row({ stock: 12, lowStockAlertAt: hoursAgo(2) })])
    await syncLowStockAlerts(db, "biz", ["p1"])
    expect(product.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { lowStockAlertAt: null } })
    expect(notified.staff).not.toHaveBeenCalled()
    expect(notified.telegram).not.toHaveBeenCalled()
  })

  it("no toca el producto si está sano y nunca se había alertado", async () => {
    product.findMany.mockResolvedValue([row({ stock: 12, lowStockAlertAt: null })])
    await syncLowStockAlerts(db, "biz", ["p1"])
    expect(product.update).not.toHaveBeenCalled()
    expect(notified.staff).not.toHaveBeenCalled()
  })
})

describe("filtros y deduplicación", () => {
  it("solo revisa productos activos del negocio (inactivos nunca alertan)", async () => {
    // La consulta filtra isActive/businessId: un inactivo no llega ni al loop.
    await syncLowStockAlerts(db, "biz", ["p1"])
    expect(product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isActive: true, businessId: "biz" }) }),
    )
    expect(product.update).not.toHaveBeenCalled()
    expect(notified.staff).not.toHaveBeenCalled()
  })

  it("deduplica ids repetidos y descarta vacíos", async () => {
    product.findMany.mockResolvedValue([row(), row({ id: "p2", name: "Batería A32" })])
    await syncLowStockAlerts(db, "biz", ["p1", "p1", "p2", ""])
    expect(product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ["p1", "p2"] } }) }),
    )
    expect(notified.staff).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("2 producto(s) bajo mínimo") }),
      "biz",
    )
  })

  it("collectLowStockIds junta ids únicos ignorando null/undefined", () => {
    expect(collectLowStockIds([
      { productId: "p1" },
      { productId: null },
      { productId: "p2" },
      {},
      { productId: "p1" },
    ])).toEqual(["p1", "p2"])
  })
})

describe("best-effort: nada se propaga", () => {
  it("un error de Telegram no propaga ni impide el aviso SSE", async () => {
    product.findMany.mockResolvedValue([row()])
    notified.telegram.mockRejectedValue(new Error("bot caído"))
    await expect(syncLowStockAlerts(db, "biz", ["p1"])).resolves.toBeUndefined()
    expect(notified.staff).toHaveBeenCalledTimes(1)
    expect(notified.telegram).toHaveBeenCalledTimes(1)
  })

  it("un error de la base de datos tampoco propaga", async () => {
    product.findMany.mockRejectedValue(new Error("conexión perdida"))
    await expect(syncLowStockAlerts(db, "biz", ["p1"])).resolves.toBeUndefined()
  })
})
