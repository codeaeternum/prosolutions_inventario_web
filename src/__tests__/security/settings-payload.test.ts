import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * PATCH/GET /api/settings: los ajustes nuevos del negocio (auto-ticket de
 * venta, modo de firma en recepción, vigencia y términos de cotización,
 * contenido de la etiqueta) se exponen con defaults seguros y se validan
 * antes de escribir nada en SystemSettings.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  settingsFindFirst: vi.fn(),
  settingsUpdate: vi.fn(),
  settingsCreate: vi.fn(),
  systemFindMany: vi.fn(),
  systemUpsert: vi.fn(),
  systemDeleteMany: vi.fn(),
  businessFindFirst: vi.fn(),
  businessFindUnique: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/api-auth", () => ({
  requireModule: vi.fn(async () => ({ session: { user: { id: "u-admin", role: "ADMIN", businessId: "biz-1" } } })),
  getSession: vi.fn((result: { session?: unknown }) => result.session ?? null),
}))
vi.mock("@/lib/tenant", () => ({ businessIdOf: vi.fn(() => "biz-1") }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    settings: {
      findFirst: mocks.settingsFindFirst,
      update: mocks.settingsUpdate,
      create: mocks.settingsCreate,
    },
    systemSettings: {
      findMany: mocks.systemFindMany,
      upsert: mocks.systemUpsert,
      deleteMany: mocks.systemDeleteMany,
    },
    business: {
      findFirst: mocks.businessFindFirst,
      findUnique: mocks.businessFindUnique,
    },
  },
}))
// Módulo real de settings (lee/escribe via el prisma mockeado arriba).

import { GET, PATCH } from "@/app/api/settings/route"

const session = { user: { id: "u-admin", role: "ADMIN", businessId: "biz-1" } }
const patchReq = (body: unknown) =>
  new Request("https://app.invalid/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

/** Llaves SystemSettings escritas durante un PATCH (key/value/type). */
const upsertedKeys = () =>
  mocks.systemUpsert.mock.calls.map(call => {
    const c = (call[0] as { create: { key: string; value: string; type: string } }).create
    return { key: c.key, value: c.value, type: c.type }
  })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(session)
  mocks.settingsFindFirst.mockResolvedValue(null)
  mocks.settingsCreate.mockResolvedValue({ id: "s1", businessId: "biz-1" })
  mocks.settingsUpdate.mockResolvedValue({ id: "s1", businessId: "biz-1" })
  mocks.systemFindMany.mockResolvedValue([])
  mocks.businessFindFirst.mockResolvedValue({ id: "biz-1" })
  mocks.businessFindUnique.mockResolvedValue({ isActive: true })
})

describe("GET /api/settings (con sesión)", () => {
  it("expone los ajustes nuevos con defaults seguros cuando no hay llaves", async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.saleAutoTicket).toBe(true)
    expect(json.repairSignatureMode).toBe("canvas")
    expect(json.quoteValidityDays).toBe(15)
    expect(typeof json.quoteTerms).toBe("string")
    expect(json.quoteTerms.length).toBeGreaterThan(0)
    expect(json.labelShowProblem).toBe(true)
    expect(json.labelShowAccess).toBe(true)
  })

  it("lee los valores guardados en SystemSettings", async () => {
    mocks.systemFindMany.mockResolvedValue([
      { key: "sale_auto_ticket", value: "false" },
      { key: "repair_signature_mode", value: "pin" },
      { key: "quote_validity_days", value: "30" },
      { key: "quote_terms", value: "Sin garantía en pantallas." },
      { key: "label_show_problem", value: "false" },
      { key: "label_show_access", value: "false" },
    ])
    const res = await GET()
    const json = await res.json()
    expect(json.saleAutoTicket).toBe(false)
    expect(json.repairSignatureMode).toBe("pin")
    expect(json.quoteValidityDays).toBe(30)
    expect(json.quoteTerms).toBe("Sin garantía en pantallas.")
    expect(json.labelShowProblem).toBe(false)
    expect(json.labelShowAccess).toBe(false)
  })

  it("valores inválidos guardados caen al default", async () => {
    mocks.systemFindMany.mockResolvedValue([
      { key: "repair_signature_mode", value: "magnetico" },
      { key: "quote_validity_days", value: "999" },
    ])
    const res = await GET()
    const json = await res.json()
    expect(json.repairSignatureMode).toBe("canvas")
    expect(json.quoteValidityDays).toBe(15)
  })
})

describe("PATCH /api/settings — validaciones previas a escribir", () => {
  it.each([0, -5, 91, 2.5, "abc"])(
    "rechaza quoteValidityDays=%s (400, sin escrituras)",
    async (value) => {
      const res = await PATCH(patchReq({ quoteValidityDays: value }))
      expect(res.status).toBe(400)
      expect(mocks.systemUpsert).not.toHaveBeenCalled()
    },
  )

  it("rechaza un repairSignatureMode desconocido (400, sin escrituras)", async () => {
    const res = await PATCH(patchReq({ repairSignatureMode: "huella" }))
    expect(res.status).toBe(400)
    expect(mocks.systemUpsert).not.toHaveBeenCalled()
  })

  it("rechaza quoteTerms no textual", async () => {
    const res = await PATCH(patchReq({ quoteTerms: 42 }))
    expect(res.status).toBe(400)
    expect(mocks.systemUpsert).not.toHaveBeenCalled()
  })

  it("guarda los toggles como BOOLEAN 'true'/'false'", async () => {
    const res = await PATCH(patchReq({ saleAutoTicket: false, labelShowProblem: false, labelShowAccess: true }))
    expect(res.status).toBe(200)
    const entries = upsertedKeys()
    expect(entries).toContainEqual({ key: "sale_auto_ticket", value: "false", type: "BOOLEAN" })
    expect(entries).toContainEqual({ key: "label_show_problem", value: "false", type: "BOOLEAN" })
    expect(entries).toContainEqual({ key: "label_show_access", value: "true", type: "BOOLEAN" })
  })

  it("guarda repair_signature_mode y quote_validity_days válidos", async () => {
    const res = await PATCH(patchReq({ repairSignatureMode: "ticket", quoteValidityDays: 30 }))
    expect(res.status).toBe(200)
    const entries = upsertedKeys()
    expect(entries).toContainEqual({ key: "repair_signature_mode", value: "ticket", type: "STRING" })
    expect(entries).toContainEqual({ key: "quote_validity_days", value: "30", type: "NUMBER" })
  })

  it("recorta y guarda quote_terms (vacío permitido = default en consumo)", async () => {
    const res = await PATCH(patchReq({ quoteTerms: "  Garantía de 30 días en mano de obra.  " }))
    expect(res.status).toBe(200)
    const entries = upsertedKeys()
    expect(entries).toContainEqual({ key: "quote_terms", value: "Garantía de 30 días en mano de obra.", type: "STRING" })
  })

  it("no escribe llaves ausentes del body", async () => {
    const res = await PATCH(patchReq({ ticketFooter: "Gracias" }))
    expect(res.status).toBe(200)
    const keys = upsertedKeys().map(e => e.key)
    expect(keys).toContain("ticket_footer")
    expect(keys).not.toContain("sale_auto_ticket")
    expect(keys).not.toContain("repair_signature_mode")
    expect(keys).not.toContain("quote_validity_days")
    expect(keys).not.toContain("quote_terms")
    expect(keys).not.toContain("label_show_problem")
    expect(keys).not.toContain("label_show_access")
  })
})
