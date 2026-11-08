import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * /api/convenio — POST decide entre liquidación individual (orderId →
 * settleConvenio) y lote (orderIds → settleConvenioBatch), propagando
 * recordCashIn y el idempotencyKey del body o del header.
 * /api/convenio/aliados — GET devuelve el catálogo deduplicado de aliados
 * de mostrador con el contacto más reciente usado por nombre.
 * El dominio se mockea: estas pruebas cubren el cableado del API (auth,
 * dispatch y forma de respuesta), no la lógica de negocio.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  convenioReport: vi.fn(),
  settleConvenio: vi.fn(),
  settleConvenioBatch: vi.fn(),
  repairOrderFindMany: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: { repairOrder: { findMany: mocks.repairOrderFindMany } },
}))
vi.mock("@/lib/domain/convenio", () => ({
  convenioReport: mocks.convenioReport,
  settleConvenio: mocks.settleConvenio,
  settleConvenioBatch: mocks.settleConvenioBatch,
}))

import { GET, POST } from "@/app/api/convenio/route"
import { GET as getAliados } from "@/app/api/convenio/aliados/route"

const session = (id: string, role: string, extra: Record<string, unknown> = {}) => ({
  user: { id, role, status: "APPROVED", businessId: "biz-1", ...extra },
})

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("https://app.invalid/api/convenio", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    })
  )

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(session("u-admin", "ADMIN"))
  mocks.convenioReport.mockResolvedValue({ porPagar: { rows: [] }, porCobrar: { rows: [] } })
  mocks.settleConvenio.mockResolvedValue({ orderId: "o-1", convenioSettledAt: null, side: "cobrar" })
  mocks.settleConvenioBatch.mockResolvedValue({ settled: [], skipped: [], totalCents: 0, side: "cobrar" })
  mocks.repairOrderFindMany.mockResolvedValue([])
})

describe("POST /api/convenio — auth", () => {
  it("sin sesión responde 401 sin tocar el dominio", async () => {
    mocks.auth.mockResolvedValue(null)
    const res = await post({ orderIds: ["o-1"], settled: true })
    expect(res.status).toBe(401)
    expect(mocks.settleConvenio).not.toHaveBeenCalled()
    expect(mocks.settleConvenioBatch).not.toHaveBeenCalled()
  })

  it("un CUSTOMER recibe 403", async () => {
    mocks.auth.mockResolvedValue(session("u-cust", "CUSTOMER"))
    const res = await post({ orderId: "o-1", settled: true })
    expect(res.status).toBe(403)
    expect(mocks.settleConvenio).not.toHaveBeenCalled()
  })

  it("un EMPLOYEE sin el módulo taller recibe 403", async () => {
    mocks.auth.mockResolvedValue(session("u-emp", "EMPLOYEE", { allowedModules: ["caja"] }))
    const res = await post({ orderId: "o-1", settled: true })
    expect(res.status).toBe(403)
    expect(mocks.settleConvenio).not.toHaveBeenCalled()
  })

  it("un EMPLOYEE con el módulo taller sí opera", async () => {
    mocks.auth.mockResolvedValue(session("u-emp", "EMPLOYEE", { allowedModules: ["taller"] }))
    const res = await post({ orderId: "o-1", settled: true })
    expect(res.status).toBe(200)
    expect(mocks.settleConvenio).toHaveBeenCalledWith(
      expect.anything(), "u-emp", "biz-1",
      expect.objectContaining({ orderId: "o-1", settled: true }),
    )
  })
})

describe("POST /api/convenio — dispatch individual vs lote", () => {
  it("con orderIds (array) llama settleConvenioBatch y propaga recordCashIn", async () => {
    const res = await post({ orderIds: ["o-1", "o-2"], settled: true, recordCashIn: true })
    expect(res.status).toBe(200)
    expect(mocks.settleConvenioBatch).toHaveBeenCalledWith(
      expect.anything(), "u-admin", "biz-1",
      expect.objectContaining({ orderIds: ["o-1", "o-2"], settled: true, recordCashIn: true }),
    )
    expect(mocks.settleConvenio).not.toHaveBeenCalled()
    expect(await res.json()).toEqual({ settled: [], skipped: [], totalCents: 0, side: "cobrar" })
  })

  it("con orderId (string) llama settleConvenio como antes, con recordCashIn", async () => {
    const res = await post({ orderId: "o-9", settled: true, recordCashIn: true })
    expect(res.status).toBe(200)
    expect(mocks.settleConvenio).toHaveBeenCalledWith(
      expect.anything(), "u-admin", "biz-1",
      expect.objectContaining({ orderId: "o-9", settled: true, recordCashIn: true }),
    )
    expect(mocks.settleConvenioBatch).not.toHaveBeenCalled()
  })

  it("sin recordCashIn el dominio recibe el input intacto (el flag es opcional)", async () => {
    const res = await post({ orderIds: ["o-1"], settled: false })
    expect(res.status).toBe(200)
    expect(mocks.settleConvenioBatch).toHaveBeenCalledWith(
      expect.anything(), "u-admin", "biz-1",
      expect.objectContaining({ orderIds: ["o-1"], settled: false }),
    )
  })

  it("el idempotencyKey viaja por header cuando el body no lo trae", async () => {
    const res = await post({ orderIds: ["o-1"], settled: true }, { "idempotency-key": "key-abc" })
    expect(res.status).toBe(200)
    expect(mocks.settleConvenioBatch).toHaveBeenCalledWith(
      expect.anything(), "u-admin", "biz-1",
      expect.objectContaining({ idempotencyKey: "key-abc" }),
    )
  })

  it("el idempotencyKey del body tiene prioridad sobre el header", async () => {
    const res = await post({ orderId: "o-1", settled: true, idempotencyKey: "key-body" }, { "idempotency-key": "key-header" })
    expect(res.status).toBe(200)
    expect(mocks.settleConvenio).toHaveBeenCalledWith(
      expect.anything(), "u-admin", "biz-1",
      expect.objectContaining({ idempotencyKey: "key-body" }),
    )
  })
})

describe("GET /api/convenio — reporte", () => {
  it("exige auth y devuelve el reporte del dominio con canSettle por rol", async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(mocks.convenioReport).toHaveBeenCalledWith(expect.anything(), "biz-1")
    expect((await res.json()).canSettle).toBe(true)
    expect(res.headers.get("Cache-Control")).toContain("no-store")
  })
})

describe("GET /api/convenio/aliados — catálogo partnerDrop", () => {
  it("sin sesión responde 401 sin consultar órdenes", async () => {
    mocks.auth.mockResolvedValue(null)
    const res = await getAliados()
    expect(res.status).toBe(401)
    expect(mocks.repairOrderFindMany).not.toHaveBeenCalled()
  })

  it("un CUSTOMER recibe 403", async () => {
    mocks.auth.mockResolvedValue(session("u-cust", "CUSTOMER"))
    const res = await getAliados()
    expect(res.status).toBe(403)
    expect(mocks.repairOrderFindMany).not.toHaveBeenCalled()
  })

  it("consulta solo originBusinessName del tenant, recientes primero y acotado", async () => {
    await getAliados()
    expect(mocks.repairOrderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: "biz-1", originBusinessName: { not: null } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 2000,
      }),
    )
  })

  it("deduplica por nombre trimmed, cuenta órdenes y conserva el contacto más reciente usado", async () => {
    // Llegan en orden desc (la primera fila es la más reciente): la última
    // orden de "Taller Norte" no capturó contacto — prevalece el "Juan" de
    // la anterior, que es el más reciente USADO con ese nombre.
    mocks.repairOrderFindMany.mockResolvedValue([
      { originBusinessName: "  Taller Norte ", originContact: null, createdAt: new Date("2024-06-01") },
      { originBusinessName: "Taller Sur", originContact: "Ana", createdAt: new Date("2024-05-01") },
      { originBusinessName: "Taller Norte", originContact: "Juan", createdAt: new Date("2024-04-01") },
      { originBusinessName: "   ", originContact: "Fantasma", createdAt: new Date("2024-03-01") },
      { originBusinessName: "Taller Sur", originContact: "Ana", createdAt: new Date("2024-02-01") },
    ])
    const res = await getAliados()
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toContain("private")
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(await res.json()).toEqual({
      aliados: [
        // orderCount desc primero; empate resuelve el nombre.
        { name: "Taller Norte", lastContact: "Juan", orderCount: 2 },
        { name: "Taller Sur", lastContact: "Ana", orderCount: 2 },
      ],
    })
    // La fila de solo espacios no genera aliado ni contacto "Fantasma".
  })

  it("el contacto de la orden más reciente gana cuando sí viene capturado", async () => {
    mocks.repairOrderFindMany.mockResolvedValue([
      { originBusinessName: "Taller Norte", originContact: "Pedro", createdAt: new Date("2024-06-01") },
      { originBusinessName: "Taller Norte", originContact: "Juan", createdAt: new Date("2024-04-01") },
    ])
    const res = await getAliados()
    expect(await res.json()).toEqual({
      aliados: [{ name: "Taller Norte", lastContact: "Pedro", orderCount: 2 }],
    })
  })

  it("ordena por orderCount desc y desempata por nombre", async () => {
    mocks.repairOrderFindMany.mockResolvedValue([
      { originBusinessName: "Zeta", originContact: null, createdAt: new Date("2024-06-01") },
      { originBusinessName: "Alfa", originContact: null, createdAt: new Date("2024-05-01") },
      { originBusinessName: "Zeta", originContact: null, createdAt: new Date("2024-04-01") },
      { originBusinessName: "Beta", originContact: null, createdAt: new Date("2024-03-01") },
      { originBusinessName: "Alfa", originContact: null, createdAt: new Date("2024-02-01") },
      { originBusinessName: "Beta", originContact: null, createdAt: new Date("2024-01-01") },
    ])
    const res = await getAliados()
    expect((await res.json()).aliados.map((a: { name: string }) => a.name)).toEqual(["Alfa", "Beta", "Zeta"])
  })
})
