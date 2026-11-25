import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  queryRaw: vi.fn(),
  productCount: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
  // Mock del tx interactivo que transaction() (domain/operations) entrega al
  // trabajo de reconciliación: la suma de BranchStock y la escritura se hacen
  // DENTRO de la tx serializable, no con la foto del escaneo.
  txBranchStockAggregate: vi.fn(),
  txProductFindFirst: vi.fn(),
  txProductUpdate: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    product: {
      count: mocks.productCount,
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
    // transaction() invoca db.$transaction(work, opts) forma interactiva: el
    // mock entrega un tx con los agregados controlados por cada prueba.
    const tx = {
      branchStock: { aggregate: mocks.txBranchStockAggregate },
      product: { findFirst: mocks.txProductFindFirst, update: mocks.txProductUpdate },
    }
    mocks.transaction.mockImplementation(async (work: (t: unknown) => unknown) => work(tx))
    mocks.queryRaw.mockResolvedValue([])
    mocks.productCount.mockResolvedValue(0)
    mocks.txBranchStockAggregate.mockResolvedValue({ _sum: { quantity: 0 } })
    mocks.txProductFindFirst.mockResolvedValue(null)
    mocks.txProductUpdate.mockResolvedValue({})
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
    // LEFT JOIN: un producto activo sin filas en BranchStock (legacy) entra
    // al agregado con Σ=0 — el INNER JOIN anterior lo escondía del drift.
    expect(sql).toContain('LEFT JOIN "BranchStock"')
    expect(sql).toContain("HAVING")
    expect(sql).toContain('"isActive" = true')
  })

  it("producto legacy sin filas en BranchStock se reporta como drift con total 0", async () => {
    // Fila que el LEFT JOIN + COALESCE produce: stock cacheado > 0, suma de
    // sucursales 0 (ninguna fila). El INNER JOIN anterior la habría omitido.
    mocks.queryRaw.mockResolvedValue([
      { productId: "p-legacy", name: "Carátula vieja", cachedStock: 5, branchesStock: 0 },
    ])
    mocks.productCount.mockResolvedValue(3)

    const res = await GET()
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.totalChecked).toBe(3)
    expect(json.drifted).toEqual([
      { productId: "p-legacy", name: "Carátula vieja", cachedStock: 5, branchesStock: 0, diff: -5 },
    ])
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
    // El JOIN del movimiento va por businessId + productId + patrón de notes:
    // movimientos de OTRA pieza con el mismo prefijo no inflan el descuento.
    expect(sql).toContain('im."productId" = rp."productId"')
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

  it("reconcilia el stock en POST recalculando la suma DENTRO de la tx y registra bitácora", async () => {
    // El escaneo (fuera de tx) reporta cached 4 vs sucursales 7. Dentro de la
    // tx serializable la suma se recalcula y concuerda con el escaneo.
    mocks.queryRaw.mockResolvedValue([
      { productId: "p-drift", name: "Batería iPhone 13", cachedStock: 4, branchesStock: 7 },
    ])
    mocks.txBranchStockAggregate.mockResolvedValue({ _sum: { quantity: 7 } })
    mocks.txProductFindFirst.mockResolvedValue({ name: "Batería iPhone 13", stock: 4 })

    const res = await POST()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.reconciledCount).toBe(1)
    expect(mocks.txProductUpdate).toHaveBeenCalledWith({
      where: { id: "p-drift" },
      data: { stock: 7 },
    })
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1)
  })

  it("concurrencia: escribe la suma VIGENTE en la tx, no la foto del escaneo (una venta intermedia no se pisa)", async () => {
    // Escaneo: cached 4 vs sucursales 7. Antes de escribir, una venta de 2
    // descuenta consistente: sucursales 7→5 y Product.stock 4→2. El drift
    // (−3) es el mismo, así que el producto sigue desalineado — pero el
    // absoluto correcto ahora es 5, no 7. Escribir la foto del escaneo (7)
    // resucitaría las 2 piezas vendidas: el bug exacto de la auditoría D4.
    mocks.queryRaw.mockResolvedValue([
      { productId: "p-drift", name: "Batería iPhone 13", cachedStock: 4, branchesStock: 7 },
    ])
    mocks.txBranchStockAggregate.mockResolvedValue({ _sum: { quantity: 5 } })
    mocks.txProductFindFirst.mockResolvedValue({ name: "Batería iPhone 13", stock: 2 })

    const res = await POST()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.reconciledCount).toBe(1)
    expect(mocks.txProductUpdate).toHaveBeenCalledWith({
      where: { id: "p-drift" },
      data: { stock: 5 },
    })
    // La fila reportada refleja los valores reales al escribir, no los del escaneo.
    expect(json.reconciled).toEqual([
      { productId: "p-drift", name: "Batería iPhone 13", cachedStock: 2, branchesStock: 5, diff: 3 },
    ])
    // La bitácora registra el antes/después real de la escritura.
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1)
    const auditData = mocks.auditCreate.mock.calls[0][0].data
    expect(auditData.changes["Batería iPhone 13"]).toEqual({ before: 2, after: 5 })
  })

  it("omite el producto que ya quedó alineado al momento de la tx (se corrigió solo entre escaneo y reconciliación)", async () => {
    // El escaneo lo marcó desfasado, pero una recepción concurrente alineó
    // ambos lados: dentro de la tx suma == stock y no hay nada que escribir.
    mocks.queryRaw.mockResolvedValue([
      { productId: "p-drift", name: "Batería iPhone 13", cachedStock: 4, branchesStock: 7 },
    ])
    mocks.txBranchStockAggregate.mockResolvedValue({ _sum: { quantity: 6 } })
    mocks.txProductFindFirst.mockResolvedValue({ name: "Batería iPhone 13", stock: 6 })

    const res = await POST()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.reconciledCount).toBe(0)
    expect(json.reconciled).toEqual([])
    expect(mocks.txProductUpdate).not.toHaveBeenCalled()
    // Sin escrituras reales no hay evento de bitácora.
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })

  it("sin drift en el escaneo no abre transacción ni escribe nada", async () => {
    mocks.queryRaw.mockResolvedValue([])

    const res = await POST()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, reconciledCount: 0, reconciled: [] })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
