import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

/**
 * POST /api/notifications/telegram — broadcast por Telegram acotado:
 * mensaje validado con zod (≤2000), audiencia default solo staff (los
 * clientes requieren audience:"all" explícita) y envío por fetch con timeout.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  userFindMany: vi.fn(),
  tgFetch: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth, handlers: { GET: vi.fn(), POST: vi.fn() } }))
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany: mocks.userFindMany } } }))

import { POST as telegramPost } from "@/app/api/notifications/telegram/route"

const session = (role = "ADMIN") => ({ user: { id: "u-1", role, status: "APPROVED", businessId: "biz-1" } })

const post = (body: unknown) =>
  telegramPost(
    new NextRequest("https://app.invalid/api/notifications/telegram", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot-token")
  vi.stubGlobal("fetch", mocks.tgFetch)
  mocks.auth.mockResolvedValue(session())
  mocks.userFindMany.mockResolvedValue([{ telegramId: "111", name: "A" }, { telegramId: "222", name: "B" }])
  mocks.tgFetch.mockResolvedValue({ ok: true })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("validación del mensaje", () => {
  it.each([
    ["sin message", {}],
    ["message vacío", { message: "   " }],
    ["message > 2000", { message: "x".repeat(2001) }],
    ["audience inválida", { message: "hola", audience: "customers" }],
  ])("400 cuando %s", async (_label, body) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(mocks.userFindMany).not.toHaveBeenCalled()
    expect(mocks.tgFetch).not.toHaveBeenCalled()
  })
})

describe("audiencia", () => {
  it("default staff: filtra role ADMIN/EMPLOYEE/WORKSHOP y status APPROVED", async () => {
    const res = await post({ message: "hola" })
    expect(res.status).toBe(200)
    const where = mocks.userFindMany.mock.calls[0][0].where
    expect(where).toMatchObject({ businessId: "biz-1", telegramId: { not: null }, status: "APPROVED" })
    expect(where.role).toEqual({ in: ["ADMIN", "EMPLOYEE", "WORKSHOP"] })
    expect(where.customerType).toBeUndefined()
  })

  it('audience "all" no filtra por rol y respeta customerType', async () => {
    const res = await post({ message: "promo", audience: "all", customerType: "STORE" })
    expect(res.status).toBe(200)
    const where = mocks.userFindMany.mock.calls[0][0].where
    expect(where.role).toBeUndefined()
    expect(where.customerType).toBe("STORE")
  })

  it('customerType sin audience "all" no se aplica (staff sigue filtrado)', async () => {
    await post({ message: "hola", customerType: "STORE" })
    const where = mocks.userFindMany.mock.calls[0][0].where
    expect(where.role).toEqual({ in: ["ADMIN", "EMPLOYEE", "WORKSHOP"] })
    expect(where.customerType).toBeUndefined()
  })
})

describe("envío", () => {
  it("manda el mensaje a cada telegramId con timeout en el fetch", async () => {
    const res = await post({ message: "aviso" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, sent: 2, failed: 0, total: 2 })
    expect(mocks.tgFetch).toHaveBeenCalledTimes(2)
    const [url, init] = mocks.tgFetch.mock.calls[0]
    expect(url).toBe("https://api.telegram.org/botbot-token/sendMessage")
    expect(JSON.parse(init.body)).toMatchObject({ chat_id: "111", text: "aviso" })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it("cuenta fallos de API y de red sin romper el resto", async () => {
    mocks.tgFetch
      .mockResolvedValueOnce({ ok: false })
      .mockRejectedValueOnce(new Error("timeout"))
    const res = await post({ message: "aviso" })
    expect(await res.json()).toMatchObject({ sent: 0, failed: 2 })
  })
})
