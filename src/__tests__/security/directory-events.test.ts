import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Contrato del beacon público /api/directory/events: solo acepta clicks con
 * un slug que exista en el directorio (isActive && showInDirectory), nunca
 * escribe otros kinds ni responde con contenido — 204/no-store.
 */
const mocks = vi.hoisted(() => ({
  findBusiness: vi.fn(),
  createEvent: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    business: { findUnique: mocks.findBusiness },
    directoryEvent: { create: mocks.createEvent },
  },
}))
import { POST as postEvent } from "@/app/api/directory/events/route"

const post = (body: string) =>
  new Request("https://app.invalid/api/directory/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findBusiness.mockResolvedValue({ id: "b1", isActive: true, showInDirectory: true })
  mocks.createEvent.mockResolvedValue({ id: "e1" })
})

describe("directory events beacon", () => {
  it("rejects malformed bodies and non-click kinds without touching the db", async () => {
    expect((await postEvent(post("{bad json"))).status).toBe(400)
    expect((await postEvent(post(JSON.stringify({ kind: "search", slug: "taller-uno" })))).status).toBe(400)
    expect((await postEvent(post(JSON.stringify({ kind: "request", slug: "taller-uno" })))).status).toBe(400)
    expect((await postEvent(post(JSON.stringify({ kind: "click" })))).status).toBe(400)
    // Slugs reservados/inválidos tampoco pasan.
    expect((await postEvent(post(JSON.stringify({ kind: "click", slug: "admin" })))).status).toBe(400)
    expect(mocks.findBusiness).not.toHaveBeenCalled()
    expect(mocks.createEvent).not.toHaveBeenCalled()
  })

  it("returns 404 for businesses outside the public directory", async () => {
    for (const business of [
      null,
      { id: "b1", isActive: false, showInDirectory: true },
      { id: "b1", isActive: true, showInDirectory: false },
    ]) {
      mocks.findBusiness.mockResolvedValueOnce(business)
      const res = await postEvent(post(JSON.stringify({ kind: "click", slug: "taller-uno" })))
      expect(res.status).toBe(404)
    }
    expect(mocks.createEvent).not.toHaveBeenCalled()
  })

  it("records a click event with the resolved businessId and answers 204 no-store", async () => {
    const res = await postEvent(post(JSON.stringify({ kind: "click", slug: "taller-uno" })))
    expect(res.status).toBe(204)
    expect(res.headers.get("cache-control")).toContain("no-store")
    expect(await res.text()).toBe("")
    expect(mocks.findBusiness).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: "taller-uno" } }),
    )
    expect(mocks.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "click", businessId: "b1" }) }),
    )
  })

  it("never breaks the response when the event insert fails", async () => {
    mocks.createEvent.mockRejectedValueOnce(new Error("db down"))
    const res = await postEvent(post(JSON.stringify({ kind: "click", slug: "taller-uno" })))
    expect(res.status).toBe(204)
  })
})
