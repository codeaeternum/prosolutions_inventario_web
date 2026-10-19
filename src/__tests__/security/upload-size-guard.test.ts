import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Rechazo temprano por Content-Length en las rutas de subida de imagen.
 *
 * formData() bufera el cuerpo completo antes de poder revisar file.size, así
 * que un POST gigante se tumba por el header ANTES de leer nada — el chequeo
 * de tamaño post-parse sigue siendo la guarda real para cuerpos sin header.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  orderFindUnique: vi.fn(),
  photoCreate: vi.fn(),
  checkAndRecord: vi.fn(() => true),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    repairOrder: { findUnique: mocks.orderFindUnique },
    repairPhoto: { create: mocks.photoCreate },
  },
}))
vi.mock("@/lib/rate-limit", () => ({
  checkAndRecord: mocks.checkAndRecord,
  getClientIp: vi.fn(() => "10.0.0.9"),
}))

import { POST as postEvidence } from "@/app/api/evidencia/[token]/route"
import { POST as postWorkshopPhoto } from "@/app/api/workshop/[id]/photos/route"
import { POST as uploadProduct } from "@/app/api/upload/product/route"

const OVER_LIMIT = String(6 * 1024 * 1024) // > 5 MB + margen multipart (64 KB)

/** Request con Content-Length enorme; formData queda booby-trapped: si la
 *  ruta intenta leer el cuerpo el test truena por la excepción, no por 413. */
function trapBody<T extends Request>(req: T): T {
  req.formData = () => Promise.reject(new Error("no debió leerse el cuerpo"))
  req.arrayBuffer = () => Promise.reject(new Error("no debió leerse el cuerpo"))
  return req
}
const bigUpload = (url: string) =>
  trapBody(new Request(url, { method: "POST", headers: { "content-length": OVER_LIMIT } }))
const bigUploadNext = (url: string) =>
  trapBody(new NextRequest(url, { method: "POST", headers: { "content-length": OVER_LIMIT } }))

const tokenParams = { params: Promise.resolve({ token: "tok-1" }) }
const idParams = { params: Promise.resolve({ id: "o1" }) }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkAndRecord.mockReturnValue(true)
  mocks.auth.mockResolvedValue({ user: { id: "e1", role: "EMPLOYEE", status: "APPROVED", businessId: "biz-1" } })
})

describe("POST /api/evidencia/[token]", () => {
  it("413 por Content-Length sin tocar la base ni leer el cuerpo", async () => {
    const res = await postEvidence(bigUpload("https://app.invalid/api/evidencia/tok-1"), tokenParams)
    expect(res.status).toBe(413)
    expect(mocks.orderFindUnique).not.toHaveBeenCalled()
    expect(mocks.photoCreate).not.toHaveBeenCalled()
    // Ni siquiera consume el cupo del rate limit.
    expect(mocks.checkAndRecord).not.toHaveBeenCalled()
  })
})

describe("POST /api/workshop/[id]/photos", () => {
  it("413 por Content-Length antes de autenticar o leer el cuerpo", async () => {
    const res = await postWorkshopPhoto(bigUpload("https://app.invalid/api/workshop/o1/photos"), idParams)
    expect(res.status).toBe(413)
    expect(mocks.auth).not.toHaveBeenCalled()
    expect(mocks.photoCreate).not.toHaveBeenCalled()
  })
})

describe("POST /api/upload/product", () => {
  it("413 por Content-Length antes de autenticar o leer el cuerpo", async () => {
    const res = await uploadProduct(bigUploadNext("https://app.invalid/api/upload/product"))
    expect(res.status).toBe(413)
    expect(mocks.auth).not.toHaveBeenCalled()
  })

  it("un Content-Length dentro del límite sigue el flujo normal", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "e1", role: "EMPLOYEE", status: "APPROVED", businessId: "biz-1" } })
    const req = new NextRequest("https://app.invalid/api/upload/product", {
      method: "POST",
      headers: { "content-length": "1024" },
    })
    // Sin multipart real: el guard deja pasar el header chico y el handler
    // continúa hasta el parseo (400 por falta de archivo — nunca 413).
    const res = await uploadProduct(req)
    expect(res.status).not.toBe(413)
  })
})
