import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * GET /api/reports — métricas del panel de reportes.
 *
 * - from > to es 400 (igual que nómina), no un reporte vacío silencioso.
 * - Los rankings (top productos / top clientes) se ordenan en BD por el
 *   conteo DEL PERIODO — antes el orderBy de _count ignoraba el filtro de
 *   fechas y el "top" del periodo era en realidad el histórico.
 * - La respuesta lleva Cache-Control no-store: ventas, caja y valuación de
 *   inventario no se sirven desde un caché compartido.
 */

// ——— Prisma mock: Proxy que auto-crea un vi.fn() por model.method ———
const db = vi.hoisted(() => ({
  fn: {} as Record<string, ReturnType<typeof vi.fn>>,
}))

const prismaMock = vi.hoisted(() => {
  const defaults: Record<string, unknown> = {
    findUnique: null,
    findFirst: null,
    count: 0,
    aggregate: { _sum: {}, _count: { _all: 0 } },
  }
  const cache = new Map<string, unknown>()
  return new Proxy({} as Record<string, unknown>, {
    get: (_t, prop: string) => {
      if (!cache.has(prop)) {
        cache.set(prop, new Proxy({} as Record<string, unknown>, {
          get: (_t2, method: string) => {
            const key = `${prop}.${method}`
            return (db.fn[key] ??= vi.fn().mockResolvedValue(method in defaults ? defaults[method] : []))
          },
        }))
      }
      return cache.get(prop)
    },
  })
})

const mocks = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock, default: prismaMock }))

import type { NextRequest } from "next/server"
import { GET as reports } from "@/app/api/reports/route"

const admin = {
  user: {
    id: "admin-1", role: "ADMIN", status: "APPROVED", businessId: "biz-test",
    customerType: "NORMAL", allowedModules: [], allowedBranchIds: [],
  },
}
const nx = (req: Request) => req as unknown as NextRequest
const q = (key: string) => {
  const [model, method] = key.split(".")
  void (prismaMock[model] as Record<string, unknown>)?.[method]
  return db.fn[key]
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(admin)
})

describe("rango de fechas", () => {
  it("from posterior a to devuelve 400 sin consultar la base", async () => {
    const res = await reports(nx(new Request("https://app.invalid/api/reports?from=2025-06-10&to=2025-06-01")))
    expect(res.status).toBe(400)
    expect(q("reservation.count")).not.toHaveBeenCalled()
    expect(q("product.findMany")).not.toHaveBeenCalled()
  })

  it("un rango válido llega como createdAt a las consultas de reservas", async () => {
    const res = await reports(nx(new Request("https://app.invalid/api/reports?from=2025-06-01&to=2025-06-10")))
    expect(res.status).toBe(200)
    expect(q("reservation.count").mock.calls[0][0].where.createdAt).toBeDefined()
  })
})

describe("rankings del periodo", () => {
  it("top productos: groupBy por productId ordenado por el conteo filtrado", async () => {
    await reports(nx(new Request("https://app.invalid/api/reports?from=2025-06-01&to=2025-06-10")))
    const productGroup = q("reservation.groupBy").mock.calls
      .map((c) => c[0])
      .find((c) => c.by?.[0] === "productId")
    expect(productGroup).toMatchObject({
      orderBy: { _count: { productId: "desc" } },
      take: 5,
    })
    // Solo productos activos y solo reservas del rango pedido.
    expect(productGroup.where.createdAt).toBeDefined()
    expect(productGroup.where.product).toEqual({ isActive: true })
  })

  it("top clientes: groupBy por userId de COMPLETED ordenado igual", async () => {
    await reports(nx(new Request("https://app.invalid/api/reports")))
    const clientGroup = q("reservation.groupBy").mock.calls
      .map((c) => c[0])
      .find((c) => c.by?.[0] === "userId")
    expect(clientGroup).toMatchObject({
      orderBy: { _count: { userId: "desc" } },
      take: 10,
    })
    expect(clientGroup.where).toMatchObject({
      status: "COMPLETED",
      user: { role: "CUSTOMER", status: "APPROVED" },
    })
  })

  it("los detalles del top se consultan por ids, no re-ordenados en memoria", async () => {
    q("reservation.groupBy").mockImplementation(async (args: { by?: string[] }) => {
      if (args.by?.[0] === "productId") return [{ productId: "p1", _count: { _all: 9 } }]
      if (args.by?.[0] === "userId") return [{ userId: "u1", _count: { _all: 4 } }]
      return []
    })
    q("product.findMany").mockResolvedValue([
      { id: "p1", name: "Pantalla", categoryId: "c1", stock: 7, minStock: 1, wholesalePrice: 100 },
    ])
    q("user.findMany").mockResolvedValue([
      { id: "u1", name: "Ana", email: "ana@x.com", customerType: "NORMAL" },
    ])
    const body = await (await reports(nx(new Request("https://app.invalid/api/reports")))).json()
    expect(body.topProducts).toEqual([{ id: "p1", name: "Pantalla", stock: 7, reservationCount: 9 }])
    expect(body.topClients).toEqual([
      { id: "u1", name: "Ana", email: "ana@x.com", customerType: "NORMAL", completedReservations: 4 },
    ])
    // El findMany de detalle solo pide los ids ganadores.
    expect(q("product.findMany").mock.calls.at(-1)?.[0].where.id).toEqual({ in: ["p1"] })
  })
})

describe("pendientes de reservas", () => {
  it("cuenta TODA reserva abierta, no solo la PENDING inicial", async () => {
    q("reservation.groupBy").mockImplementation(async (args: { by?: string[] }) => {
      if (args.by?.[0] !== "status") return []
      return [
        { status: "PENDING", _count: { status: 2 } },
        { status: "PENDING_PAYMENT", _count: { status: 3 } },
        { status: "DEPOSIT_VERIFIED", _count: { status: 1 } },
        { status: "APPROVED", _count: { status: 4 } },
        { status: "COMPLETED", _count: { status: 8 } },
      ]
    })
    const body = await (await reports(nx(new Request("https://app.invalid/api/reports")))).json()
    // 2+3+1+4 = 10 por atender (antes eran solo las 2 PENDING).
    expect(body.pendingReservations).toBe(10)
    expect(body.completedReservations).toBe(8)
  })
})

describe("caché", () => {
  it("las métricas con dinero se sirven con Cache-Control no-store", async () => {
    const res = await reports(nx(new Request("https://app.invalid/api/reports")))
    expect(res.headers.get("Cache-Control")).toContain("no-store")
  })
})
