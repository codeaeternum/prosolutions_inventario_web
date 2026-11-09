import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  queryRaw: vi.fn(),
  productCount: vi.fn(),
  productUpdate: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    product: {
      count: mocks.productCount,
      update: mocks.productUpdate,
    },
    auditEvent: {
      create: mocks.auditCreate,
    },
    $transaction: mocks.transaction,
  },
}))

import { GET, POST } from "@/app/api/inventory/health/route"

describe("GET & POST /api/inventory/health — verificación y reconciliación de stock", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({
      user: { id: "u-admin", role: "ADMIN", status: "APPROVED", businessId: "biz-1" },
    })
    mocks.transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops))
    mocks.queryRaw.mockResolvedValue([])
    mocks.productCount.mockResolvedValue(0)
    mocks.productUpdate.mockResolvedValue({})
    mocks.auditCreate.mockResolvedValue({})
  })

  it("detecta productos cuyo Product.stock difiere de la suma de BranchStock", async () => {
    // El drift se calcula en SQL (JOIN Product↔BranchStock + HAVING): la
    // consulta solo devuelve los desfasados; el total sale del count.
    mocks.queryRaw.mockResolvedValue([
      { productId: "p-drift", name: "Batería iPhone 13", cachedStock: 4, branchesStock: 7 },
    ])
    mocks.productCount.mockResolvedValue(2)

    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.totalChecked).toBe(2)
    expect(json.driftedCount).toBe(1)
    expect(json.drifted).toEqual([
      {
        productId: "p-drift",
        name: "Batería iPhone 13",
        cachedStock: 4,
        branchesStock: 7,
        diff: 3,
      },
    ])
    // La comparación y el recorte van en la consulta parametrizada.
    const [strings, businessId] = mocks.queryRaw.mock.calls[0] as unknown as [TemplateStringsArray, string]
    const sql = strings.join(" ")
    expect(businessId).toBe("biz-1")
    expect(sql).toContain('JOIN "BranchStock"')
    expect(sql).toContain("HAVING")
    expect(sql).toContain('"isActive" = true')
  })

  it("reporta refacciones cobradas con descuento de inventario incompleto", async () => {
    // queryRaw corre dos veces: drift (vacío) y luego las partes cargadas
    // con deducted < qty — el patrón de conciliación del syncPartStock.
    mocks.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          partId: "part-1", orderId: "o1", orderNumber: 12, orderStatus: "READY",
          description: "Flex de carga", qty: 2, deducted: 1, totalCount: 2,
        },
        {
          partId: "part-2", orderId: "o2", orderNumber: 9, orderStatus: "REPAIRING",
          description: "Tapa trasera", qty: 3, deducted: 0, totalCount: 2,
        },
      ])

    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.chargedWithoutStock.count).toBe(2)
    expect(json.chargedWithoutStock.parts).toEqual([
      {
        partId: "part-1", orderId: "o1", orderNumber: 12, orderStatus: "READY",
        description: "Flex de carga", qty: 2, deducted: 1, missing: 1,
      },
      {
        partId: "part-2", orderId: "o2", orderNumber: 9, orderStatus: "REPAIRING",
        description: "Tapa trasera", qty: 3, deducted: 0, missing: 3,
      },
    ])
    // La consulta es tenant-scoped, une con la OT y ancla el movimiento al
    // mismo patrón de notes que escribe syncPartStock; viene acotada.
    const [strings, businessId] = mocks.queryRaw.mock.calls[1] as unknown as [TemplateStringsArray, string]
    const sql = strings.join(" ")
    expect(businessId).toBe("biz-1")
    expect(sql).toContain('FROM "RepairPart"')
    expect(sql).toContain('JOIN "RepairOrder"')
    expect(sql).toContain('"notes" LIKE')
    expect(sql).toContain("Refacción OT ")
    expect(sql).toContain('rp."status" = \'APPROVED\'')
    expect(sql).toContain("LIMIT")
    expect(sql).toContain('rp."businessId" =')
  })

  it("chargedWithoutStock vacío cuando todas las refacciones descontaron completo", async () => {
    mocks.queryRaw.mockResolvedValue([])
    const res = await GET()
    const json = await res.json()
    expect(json.chargedWithoutStock).toEqual({ count: 0, parts: [] })
  })

  it("reconcilia el stock en POST y registra evento en la bitácora", async () => {
    mocks.queryRaw.mockResolvedValue([
      { productId: "p-drift", name: "Batería iPhone 13", cachedStock: 4, branchesStock: 7 },
    ])

    const res = await POST()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.reconciledCount).toBe(1)
    expect(mocks.productUpdate).toHaveBeenCalledWith({
      where: { id: "p-drift" },
      data: { stock: 7 },
    })
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1)
  })
})
