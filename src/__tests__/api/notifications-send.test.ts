import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

/**
 * POST /api/notifications/send — validación del body con zod.
 * El send real cae en broadcast() del stream route (importado de verdad) cuya
 * persistencia en prisma.notification.create queda mockeada.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  notifCreate: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth, handlers: { GET: vi.fn(), POST: vi.fn() } }))
vi.mock("@/lib/prisma", () => ({
  prisma: { notification: { create: mocks.notifCreate } },
}))

import { POST as sendNotification } from "@/app/api/notifications/send/route"

const session = (role = "ADMIN") => ({ user: { id: "u-1", role, status: "APPROVED", businessId: "biz-1" } })

const post = (body: unknown) =>
  sendNotification(
    new NextRequest("https://app.invalid/api/notifications/send", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(session())
  mocks.notifCreate.mockResolvedValue({ id: "n-1" })
})

describe("validación del body", () => {
  it.each([
    ["type arbitrario", { type: "shell_exec", title: "t", message: "m" }],
    ["type ausente", { title: "t", message: "m" }],
    ["título vacío", { type: "low_stock", title: "   ", message: "m" }],
    ["título > 120", { type: "low_stock", title: "x".repeat(121), message: "m" }],
    ["mensaje > 500", { type: "low_stock", title: "t", message: "x".repeat(501) }],
    ["data no objeto", { type: "low_stock", title: "t", message: "m", data: "nope" }],
    ["data gigante", { type: "low_stock", title: "t", message: "m", data: { blob: "x".repeat(5000) } }],
    ["data muy anidada", { type: "low_stock", title: "t", message: "m", data: { a: { b: { c: { d: { e: { f: 1 } } } } } } }],
  ])("400 cuando %s", async (_label, body) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(mocks.notifCreate).not.toHaveBeenCalled()
  })

  it("acepta cada NotificationType conocido", async () => {
    for (const type of ["new_reservation", "low_stock", "sensitive_alert", "delegation_update"]) {
      const res = await post({ type, title: "t", message: "m" })
      expect(res.status).toBe(200)
    }
  })

  it("payload válido llega al broadcast con el businessId de la sesión", async () => {
    const res = await post({ type: "low_stock", title: " Stock bajo ", message: "Falta pantalla", data: { products: 2 } })
    expect(res.status).toBe(200)
    // Fire-and-forget: dejamos que el broadcast persista la fila.
    await vi.waitFor(() => expect(mocks.notifCreate).toHaveBeenCalledTimes(1))
    const data = mocks.notifCreate.mock.calls[0][0].data
    expect(data).toMatchObject({ businessId: "biz-1", type: "low_stock", title: "Stock bajo", message: "Falta pantalla" })
  })
})
