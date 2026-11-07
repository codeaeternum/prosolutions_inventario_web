import { createHash } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Subida de evidencias — dos canales:
 *
 * 1. POST /api/evidencia/[token] (público, uploadToken de la orden): el label
 *    del cliente no es texto libre — solo pasan las sugerencias de la página;
 *    lo demás cae a "Evidencia" (la galería del seguimiento no lleva texto
 *    arbitrario de quien tenga el link).
 * 2. POST /api/workshop/[id]/photos (staff): label libre permitido, pero la
 *    respuesta nunca expone filePath interno; rate-limit por usuario e
 *    idempotencyKey opcional con recibo BusinessOperation.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  orderFindUnique: vi.fn(),
  photoCreate: vi.fn(),
  photoUpdate: vi.fn(),
  eventCreate: vi.fn(),
  opFindUnique: vi.fn(),
  opCreate: vi.fn(),
  writeRepairPhoto: vi.fn(),
  deleteRepairPhotoFile: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    repairOrder: { findUnique: mocks.orderFindUnique },
    repairPhoto: { create: mocks.photoCreate, update: mocks.photoUpdate },
    repairEvent: { create: mocks.eventCreate },
    businessOperation: { findUnique: mocks.opFindUnique, create: mocks.opCreate },
  },
}))
vi.mock("@/lib/repair-evidence", () => ({
  MAX_EVIDENCE_BYTES: 5 * 1024 * 1024,
  evidenceImageFormat: vi.fn(() => ({ extension: "png", mime: "image/png" })),
  writeRepairPhoto: mocks.writeRepairPhoto,
  deleteRepairPhotoFile: mocks.deleteRepairPhotoFile,
}))

import { POST as publicUpload } from "@/app/api/evidencia/[token]/route"
import { POST as staffUpload } from "@/app/api/workshop/[id]/photos/route"

const tokenParams = { params: Promise.resolve({ token: "upload-token-1" }) }
const idParams = { params: Promise.resolve({ id: "order-1" }) }

const uploadReq = (url: string, label?: string, extra?: Record<string, string>) => {
  const form = new FormData()
  form.append("file", new File([new Uint8Array([137, 80, 78, 71])], "e.png", { type: "image/png" }))
  if (label !== undefined) form.append("label", label)
  for (const [key, value] of Object.entries(extra ?? {})) form.append(key, value)
  return new Request(url, { method: "POST", body: form })
}

const publicOrder = {
  id: "order-1", createdById: "u-staff", businessId: "biz-1",
  status: "IN_REPAIR", uploadTokenExpiresAt: null,
  business: { isActive: true },
}

const session = (role: string, id = `u-${role}`) => ({
  user: { id, role, status: "APPROVED", businessId: "biz-1" },
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.orderFindUnique.mockResolvedValue(publicOrder)
  mocks.photoCreate.mockImplementation(({ data }) => Promise.resolve({ id: "p1", label: data.label ?? null, createdAt: new Date("2026-01-02") }))
  mocks.photoUpdate.mockImplementation(({ data }) => Promise.resolve({ id: "p1", label: "Detalle", filePath: data.filePath, createdAt: new Date("2026-01-02") }))
  mocks.eventCreate.mockResolvedValue({})
  mocks.writeRepairPhoto.mockResolvedValue("data/uploads/repairs/order-1/p1.png")
  mocks.opFindUnique.mockResolvedValue(null)
  mocks.opCreate.mockResolvedValue({})
})

describe("POST /api/evidencia/[token] — label público va a whitelist", () => {
  const lastCreateData = () => (mocks.photoCreate.mock.calls.at(-1)?.[0] as { data: { label: string | null } }).data

  it("una sugerencia válida se conserva", async () => {
    const res = await publicUpload(uploadReq("https://app.invalid/api/evidencia/tok", "Detalle"), tokenParams)
    expect(res.status).toBe(201)
    expect(lastCreateData().label).toBe("Detalle")
  })

  it("la sugerencia se normaliza a su forma canónica", async () => {
    const res = await publicUpload(uploadReq("https://app.invalid/api/evidencia/tok", "frente"), tokenParams)
    expect(res.status).toBe(201)
    expect(lastCreateData().label).toBe("Frente")
  })

  it("texto arbitrario cae a \"Evidencia\" — no se publica tal cual", async () => {
    const res = await publicUpload(uploadReq("https://app.invalid/api/evidencia/tok", "VISITA MI SITIO <b>spam</b>"), tokenParams)
    expect(res.status).toBe(201)
    expect(lastCreateData().label).toBe("Evidencia")
  })

  it("sin label queda null como antes", async () => {
    const res = await publicUpload(uploadReq("https://app.invalid/api/evidencia/tok"), tokenParams)
    expect(res.status).toBe(201)
    expect(lastCreateData().label).toBeNull()
  })

  // La página pública manda una idempotencyKey por archivo: un reintento con
  // la misma llave+archivo no debe duplicar la foto (mismo patrón que el
  // upload de staff).
  const pubHashOf = (label: string | null) =>
    createHash("sha256").update(JSON.stringify({ orderId: "order-1", label })).update(new Uint8Array([137, 80, 78, 71])).digest("hex")

  it("reintento con la misma llave devuelve la foto ya creada", async () => {
    mocks.opFindUnique.mockResolvedValue({
      key: "pub-key-1", actorId: "u-staff", businessId: "biz-1",
      kind: "PUBLIC_EVIDENCE_UPLOAD", requestHash: pubHashOf("Evidencia"),
      response: { photo: { id: "p9", label: "Evidencia", createdAt: "2026-01-01T00:00:00.000Z" } },
    })
    const res = await publicUpload(uploadReq("https://app.invalid/api/evidencia/tok", "basura", { idempotencyKey: "pub-key-1" }), tokenParams)
    expect(res.status).toBe(201)
    expect((await res.json()).photo.id).toBe("p9")
    expect(mocks.photoCreate).not.toHaveBeenCalled()
    expect(mocks.writeRepairPhoto).not.toHaveBeenCalled()
  })

  it("la llave rehusada con otro contenido es conflicto (409)", async () => {
    mocks.opFindUnique.mockResolvedValue({
      key: "pub-key-2", actorId: "u-staff", businessId: "biz-1",
      kind: "PUBLIC_EVIDENCE_UPLOAD", requestHash: pubHashOf("Frente"),
      response: { photo: { id: "p9", label: "Frente", createdAt: "2026-01-01" } },
    })
    const res = await publicUpload(uploadReq("https://app.invalid/api/evidencia/tok", "Detalle", { idempotencyKey: "pub-key-2" }), tokenParams)
    expect(res.status).toBe(409)
    expect(mocks.photoCreate).not.toHaveBeenCalled()
  })

  it("primera subida con llave guarda el recibo; llave malformada se ignora", async () => {
    let res = await publicUpload(uploadReq("https://app.invalid/api/evidencia/tok", "Detalle", { idempotencyKey: "pub-key-3" }), tokenParams)
    expect(res.status).toBe(201)
    expect(mocks.opCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ key: "pub-key-3", kind: "PUBLIC_EVIDENCE_UPLOAD", businessId: "biz-1" }),
    }))
    // Malformada: el upload sigue normal sin consultar recibo alguno.
    vi.clearAllMocks()
    mocks.orderFindUnique.mockResolvedValue(publicOrder)
    mocks.photoCreate.mockImplementation(({ data }) => Promise.resolve({ id: "p2", label: data.label ?? null, createdAt: new Date() }))
    mocks.photoUpdate.mockImplementation(({ data }) => Promise.resolve({ id: "p2", label: data.label ?? null, filePath: data.filePath, createdAt: new Date() }))
    mocks.writeRepairPhoto.mockResolvedValue("data/uploads/repairs/order-1/p2.png")
    res = await publicUpload(uploadReq("https://app.invalid/api/evidencia/tok", undefined, { idempotencyKey: "!" }), tokenParams)
    expect(res.status).toBe(201)
    expect(mocks.opFindUnique).not.toHaveBeenCalled()
    expect(mocks.opCreate).not.toHaveBeenCalled()
  })
})

describe("POST /api/workshop/[id]/photos — respuesta e idempotencia", () => {
  it("la respuesta no expone filePath interno (solo id/label/fecha)", async () => {
    mocks.auth.mockResolvedValue(session("EMPLOYEE", "u-photo-a"))
    mocks.orderFindUnique.mockResolvedValue({ id: "order-1", status: "IN_REPAIR", currentBranchId: "b1" })
    mocks.photoUpdate.mockResolvedValue({ id: "p1", label: "Motor", filePath: "data/uploads/repairs/order-1/p1.png", createdAt: new Date("2026-01-02") })
    const res = await staffUpload(uploadReq("https://app.invalid/api/workshop/order-1/photos", "Motor"), idParams)
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.photo).toEqual({ id: "p1", label: "Motor", createdAt: expect.any(String) })
    expect(JSON.stringify(json)).not.toContain("filePath")
    expect(JSON.stringify(json)).not.toContain("data/uploads")
  })

  it("staff conserva label libre (no va a whitelist)", async () => {
    mocks.auth.mockResolvedValue(session("EMPLOYEE", "u-photo-b"))
    mocks.orderFindUnique.mockResolvedValue({ id: "order-1", status: "IN_REPAIR", currentBranchId: "b1" })
    const res = await staffUpload(uploadReq("https://app.invalid/api/workshop/order-1/photos", "Tornillo flojo en tapa"), idParams)
    expect(res.status).toBe(201)
    const data = mocks.photoCreate.mock.calls[0][0] as { data: { label: string | null } }
    expect(data.data.label).toBe("Tornillo flojo en tapa")
  })

  // El recibo guarda requestHash = sha256({orderId,label} + bytes del archivo).
  const hashOf = (label: string | null) =>
    createHash("sha256").update(JSON.stringify({ orderId: "order-1", label })).update(new Uint8Array([137, 80, 78, 71])).digest("hex")

  it("idempotencyKey: el reintento con misma llave+archivo devuelve la foto ya creada", async () => {
    mocks.auth.mockResolvedValue(session("EMPLOYEE", "u-photo-c"))
    mocks.orderFindUnique.mockResolvedValue({ id: "order-1", status: "IN_REPAIR", currentBranchId: "b1" })
    mocks.opFindUnique.mockResolvedValue({
      key: "photo-key-1", actorId: "u-photo-c", businessId: "biz-1",
      kind: "REPAIR_PHOTO_UPLOAD",
      requestHash: hashOf("Detalle"),
      response: { photo: { id: "p0", label: "Detalle", createdAt: "2026-01-01T00:00:00.000Z" } },
    })
    const res = await staffUpload(uploadReq("https://app.invalid/api/workshop/order-1/photos", "Detalle", { idempotencyKey: "photo-key-1" }), idParams)
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.photo.id).toBe("p0") // la foto del recibo, no una nueva
    expect(mocks.photoCreate).not.toHaveBeenCalled()
    expect(mocks.writeRepairPhoto).not.toHaveBeenCalled()
  })

  it("idempotencyKey rehusada con OTRO archivo/etiqueta es conflicto (409)", async () => {
    mocks.auth.mockResolvedValue(session("EMPLOYEE", "u-photo-c2"))
    mocks.orderFindUnique.mockResolvedValue({ id: "order-1", status: "IN_REPAIR", currentBranchId: "b1" })
    mocks.opFindUnique.mockResolvedValue({
      key: "photo-key-2", actorId: "u-photo-c2", businessId: "biz-1",
      kind: "REPAIR_PHOTO_UPLOAD", requestHash: hashOf("Otra etiqueta"),
      response: { photo: { id: "p0", label: "Otra etiqueta", createdAt: "2026-01-01" } },
    })
    const res = await staffUpload(uploadReq("https://app.invalid/api/workshop/order-1/photos", "Detalle", { idempotencyKey: "photo-key-2" }), idParams)
    expect(res.status).toBe(409)
    expect(mocks.photoCreate).not.toHaveBeenCalled()
  })

  it("primera subida con llave guarda el recibo BusinessOperation", async () => {
    mocks.auth.mockResolvedValue(session("EMPLOYEE", "u-photo-c3"))
    mocks.orderFindUnique.mockResolvedValue({ id: "order-1", status: "IN_REPAIR", currentBranchId: "b1" })
    const res = await staffUpload(uploadReq("https://app.invalid/api/workshop/order-1/photos", "Detalle", { idempotencyKey: "photo-key-3" }), idParams)
    expect(res.status).toBe(201)
    expect(mocks.opCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ key: "photo-key-3", kind: "REPAIR_PHOTO_UPLOAD", businessId: "biz-1", actorId: "u-photo-c3" }),
    }))
  })

  it("idempotencyKey con formato inválido responde 400", async () => {
    mocks.auth.mockResolvedValue(session("EMPLOYEE", "u-photo-d"))
    mocks.orderFindUnique.mockResolvedValue({ id: "order-1", status: "IN_REPAIR", currentBranchId: "b1" })
    const res = await staffUpload(uploadReq("https://app.invalid/api/workshop/order-1/photos", undefined, { idempotencyKey: "x" }), idParams)
    expect(res.status).toBe(400)
    expect(mocks.photoCreate).not.toHaveBeenCalled()
  })
})
