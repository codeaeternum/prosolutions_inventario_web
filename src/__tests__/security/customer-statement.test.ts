import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Estado de cuenta público (/api/cuenta/[token]): el statementToken es la
 * frontera de seguridad. Se verifica el ciclo de vida (404 inexistente /
 * negocio suspendido, 410 vencido), la selección estricta de campos (nunca
 * ids internos, email, teléfono ni datos de otros clientes) y la emisión del
 * link autenticada (POST rota el token, GET consulta sin rotar).
 */

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  userUpdate: vi.fn(),
  movementFindMany: vi.fn(),
  saleFindMany: vi.fn(),
  checkAndRecord: vi.fn(() => true),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
      findFirst: mocks.userFindFirst,
      update: mocks.userUpdate,
    },
    creditMovement: { findMany: mocks.movementFindMany },
    sale: { findMany: mocks.saleFindMany },
  },
}))
vi.mock("@/lib/rate-limit", () => ({
  checkAndRecord: mocks.checkAndRecord,
  getClientIp: vi.fn(() => "10.0.0.9"),
}))
vi.mock("@/lib/api-auth", () => ({
  requireModule: async () => ({ session: { user: { id: "admin", role: "ADMIN", businessId: "biz-test" } } }),
  getSession: vi.fn((result: { session?: unknown }) => result.session ?? null),
}))

import { GET as getStatement } from "@/app/api/cuenta/[token]/route"
import { GET as getStatementLink, POST as postStatementLink } from "@/app/api/clientes/[id]/statement-link/route"
import { STATEMENT_TOKEN_TTL_MS } from "@/lib/customer-statement"

const tokenParams = { params: Promise.resolve({ token: "tok-1" }) }
const idParams = { params: Promise.resolve({ id: "cust-1" }) }
const req = (method = "GET") => new Request("https://app.invalid/api/cuenta/tok-1", { method })

// Fila tal como la lee el loader público (select por statementToken).
const statementUser = (over: Record<string, unknown> = {}) => ({
  id: "cust-1",
  name: "María Cliente",
  creditBalance: 450,
  creditLimit: 2000,
  statementTokenExpiresAt: new Date(Date.now() + 60_000),
  business: { name: "Refaccionaria Demo", isActive: true },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkAndRecord.mockReturnValue(true)
  mocks.movementFindMany.mockResolvedValue([])
  mocks.saleFindMany.mockResolvedValue([])
})

describe("GET /api/cuenta/[token]", () => {
  it("token inexistente o negocio suspendido responde 404 genérico", async () => {
    mocks.userFindUnique.mockResolvedValue(null)
    expect((await getStatement(req(), tokenParams)).status).toBe(404)
    mocks.userFindUnique.mockResolvedValue(statementUser({ business: { name: "X", isActive: false } }))
    expect((await getStatement(req(), tokenParams)).status).toBe(404)
    // Un 404 nunca intenta leer movimientos ni ventas.
    expect(mocks.movementFindMany).not.toHaveBeenCalled()
  })

  it("token vencido responde 410 con el mensaje de vigencia", async () => {
    mocks.userFindUnique.mockResolvedValue(
      statementUser({ statementTokenExpiresAt: new Date(Date.now() - 60_000) })
    )
    const res = await getStatement(req(), tokenParams)
    expect(res.status).toBe(410)
    expect((await res.json()).error).toContain("ya no está vigente")
    expect(mocks.movementFindMany).not.toHaveBeenCalled()
  })

  it("sin caducidad (NULL) sigue funcionando", async () => {
    mocks.userFindUnique.mockResolvedValue(statementUser({ statementTokenExpiresAt: null }))
    expect((await getStatement(req(), tokenParams)).status).toBe(200)
  })

  it("token vigente responde 200 con el estado de cuenta", async () => {
    mocks.userFindUnique.mockResolvedValue(statementUser())
    mocks.movementFindMany.mockResolvedValue([
      { type: "PAYMENT", amount: 50, notes: "Abono en mostrador", createdAt: new Date("2026-12-01") },
      { type: "DEBT", amount: 500, notes: null, createdAt: new Date("2026-11-30") },
    ])
    mocks.saleFindMany.mockResolvedValue([
      {
        number: 123,
        total: 1000,
        expiresAt: new Date("2026-12-31"),
        createdAt: new Date("2026-12-05"),
        payments: [{ amount: 300 }, { amount: 200 }],
      },
    ])
    const res = await getStatement(req(), tokenParams)
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    const json = await res.json()
    expect(json.statement).toMatchObject({
      businessName: "Refaccionaria Demo",
      customerName: "María Cliente",
      creditBalance: 450,
      creditLimit: 2000,
    })
    expect(json.statement.movements[0]).toMatchObject({ type: "PAYMENT", amount: 50, note: "Abono en mostrador" })
    expect(json.statement.layaways[0]).toMatchObject({
      number: 123,
      folio: "V-000123",
      total: 1000,
      paid: 500,
      balance: 500,
    })
  })

  it("no expone campos prohibidos: ids internos, contacto ni tokens", async () => {
    mocks.userFindUnique.mockResolvedValue(statementUser())
    mocks.movementFindMany.mockResolvedValue([
      { type: "DEBT", amount: 500, notes: "Cargo", createdAt: new Date() },
    ])
    mocks.saleFindMany.mockResolvedValue([
      { number: 9, total: 100, expiresAt: null, createdAt: new Date(), payments: [] },
    ])
    const res = await getStatement(req(), tokenParams)
    const json = await res.json()

    // El payload es exacto: ni el cliente ni sus filas traen llaves internas.
    expect(Object.keys(json.statement).sort()).toEqual(
      ["businessName", "creditBalance", "creditLimit", "customerName", "layaways", "movements"].sort()
    )
    expect(Object.keys(json.statement.movements[0]).sort()).toEqual(
      ["amount", "createdAt", "note", "type"].sort()
    )
    expect(Object.keys(json.statement.layaways[0]).sort()).toEqual(
      ["balance", "createdAt", "expiresAt", "folio", "number", "paid", "total"].sort()
    )

    // Y el serializado completo no filtra valores internos conocidos.
    const body = JSON.stringify(json)
    for (const leaked of ["cust-1", "biz-test", "statementToken", "email", "phone", "userId", "customerId", "businessId"]) {
      expect(body).not.toContain(leaked)
    }
  })

  it("rate limit responde 429 sin consultar la base", async () => {
    mocks.checkAndRecord.mockReturnValue(false)
    const res = await getStatement(req(), tokenParams)
    expect(res.status).toBe(429)
    expect(mocks.userFindUnique).not.toHaveBeenCalled()
  })
})

describe("POST /api/clientes/[id]/statement-link", () => {
  it("rota el token y devuelve el path /cuenta/<token>", async () => {
    mocks.userFindFirst.mockResolvedValue({ id: "cust-1", business: { name: "Refaccionaria Demo" } })
    mocks.userUpdate.mockResolvedValue({})
    const res = await postStatementLink(req("POST"), idParams)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.url).toMatch(/^\/cuenta\//)
    expect(json.businessName).toBe("Refaccionaria Demo")
    expect(new Date(json.expiresAt).getTime()).toBeGreaterThan(Date.now())

    // La escritura guarda token nuevo + vigencia de 30 días para este cliente.
    const update = mocks.userUpdate.mock.calls[0][0] as {
      where: { id: string }
      data: { statementToken: string; statementTokenExpiresAt: Date }
    }
    expect(update.where.id).toBe("cust-1")
    expect(update.data.statementToken).toBe(json.url.replace("/cuenta/", ""))
    expect(update.data.statementTokenExpiresAt.getTime() - Date.now()).toBeGreaterThan(STATEMENT_TOKEN_TTL_MS - 60_000)
  })

  it("cliente de otro negocio o inexistente responde 404 y no escribe", async () => {
    mocks.userFindFirst.mockResolvedValue(null)
    const res = await postStatementLink(req("POST"), idParams)
    expect(res.status).toBe(404)
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })
})

describe("GET /api/clientes/[id]/statement-link", () => {
  it("devuelve el link vigente sin rotarlo", async () => {
    mocks.userFindFirst.mockResolvedValue({
      statementToken: "tok-vigente",
      statementTokenExpiresAt: new Date(Date.now() + 60_000),
    })
    const res = await getStatementLink(req(), idParams)
    expect(res.status).toBe(200)
    expect((await res.json()).url).toBe("/cuenta/tok-vigente")
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it("devuelve url null sin token o vencido", async () => {
    mocks.userFindFirst.mockResolvedValue({ statementToken: null, statementTokenExpiresAt: null })
    expect((await (await getStatementLink(req(), idParams)).json()).url).toBeNull()
    mocks.userFindFirst.mockResolvedValue({
      statementToken: "tok-viejo",
      statementTokenExpiresAt: new Date(Date.now() - 60_000),
    })
    expect((await (await getStatementLink(req(), idParams)).json()).url).toBeNull()
  })
})
