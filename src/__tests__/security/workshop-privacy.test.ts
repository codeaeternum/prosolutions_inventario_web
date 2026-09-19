import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Privacidad del taller: el listado /api/workshop no serializa secretos
 * (PIN/patrón, firma, tokens públicos), el rastreo público solo publica
 * eventos isPublic, la decisión de cotización exige el monto visto y las
 * evidencias de órdenes cerradas quedan limitadas a ADMIN.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  orderFindMany: vi.fn(),
  orderCount: vi.fn(),
  orderFindUnique: vi.fn(),
  orderUpdateMany: vi.fn(),
  paymentGroupBy: vi.fn(),
  partFindMany: vi.fn(),
  branchFindMany: vi.fn(),
  userFindMany: vi.fn(),
  eventFindFirst: vi.fn(),
  eventCreate: vi.fn(),
  photoFindFirst: vi.fn(),
  photoCreate: vi.fn(),
  photoUpdate: vi.fn(),
  photoDelete: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => {
  const db = {
    repairOrder: {
      findMany: mocks.orderFindMany,
      count: mocks.orderCount,
      findUnique: mocks.orderFindUnique,
      updateMany: mocks.orderUpdateMany,
    },
    payment: { groupBy: mocks.paymentGroupBy },
    repairPart: { findMany: mocks.partFindMany },
    repairPhoto: {
      findFirst: mocks.photoFindFirst,
      create: mocks.photoCreate,
      update: mocks.photoUpdate,
      delete: mocks.photoDelete,
    },
    repairEvent: { findFirst: mocks.eventFindFirst, create: mocks.eventCreate },
    branch: { findMany: mocks.branchFindMany },
    user: { findMany: mocks.userFindMany },
    // transaction(prisma, work) llama db.$transaction(work): el "tx" es el
    // mismo mock — las operaciones internas quedan registradas en mocks.
    $transaction: (work: (tx: unknown) => Promise<unknown>) => work(db),
  }
  return { prisma: db }
})
vi.mock("@/lib/domain/workshop", () => ({ createRepair: vi.fn(), updateRepair: vi.fn() }))
vi.mock("@/app/api/notifications/stream/route", () => ({ sendNotificationToStaff: vi.fn(async () => {}) }))
vi.mock("@/lib/settings", () => ({ getBusinessSetting: vi.fn(async () => "Taller Test") }))

import { GET as workshopList } from "@/app/api/workshop/route"
import { GET as seguimiento } from "@/app/api/seguimiento/route"
import { POST as decideQuote } from "@/app/api/cotizacion/[token]/approve/route"
import { GET as quoteDoc } from "@/app/api/cotizacion/[token]/route"
import { POST as uploadPhoto, DELETE as deletePhoto } from "@/app/api/workshop/[id]/photos/route"

vi.stubEnv("TRUST_PROXY_HEADERS", "true")
let ipCounter = 0
const nextIp = () => `10.9.0.${++ipCounter}`

const session = (role: string) => ({
  user: { id: `u-${role}`, role, status: "APPROVED", businessId: "biz-1" },
})

const tokenParams = { params: Promise.resolve({ token: "tok-1" }) }
const idParams = { params: Promise.resolve({ id: "order-1" }) }

const pendingQuoteOrder = {
  id: "order-1", number: 7, version: 3, status: "WAITING_APPROVAL",
  businessId: "biz-1", quoteCents: 150000, approvedQuoteCents: null,
  quoteApprovedAt: null, createdById: "u-ADMIN",
  equipmentType: "Celular", brand: "Moto", model: "G",
  business: { isActive: true }, parts: [],
}

const approveReq = (body: unknown) =>
  new Request("https://app.invalid/api/cotizacion/tok-1/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-real-ip": nextIp() },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.orderFindMany.mockResolvedValue([])
  mocks.orderCount.mockResolvedValue(0)
  mocks.branchFindMany.mockResolvedValue([])
  mocks.userFindMany.mockResolvedValue([])
  mocks.paymentGroupBy.mockResolvedValue([])
  mocks.partFindMany.mockResolvedValue([])
  mocks.orderUpdateMany.mockResolvedValue({ count: 1 })
  mocks.eventFindFirst.mockResolvedValue(null)
  mocks.eventCreate.mockResolvedValue({})
})

describe("GET /api/workshop (listado)", () => {
  it("pide a Prisma omitir secretos: deviceAccessValue, signatureData y tokens", async () => {
    mocks.auth.mockResolvedValue(session("EMPLOYEE"))
    const res = await workshopList(new Request("https://app.invalid/api/workshop"))
    expect(res.status).toBe(200)
    const args = mocks.orderFindMany.mock.calls[0][0] as { omit?: Record<string, boolean> }
    expect(args.omit).toMatchObject({
      deviceAccessValue: true,
      signatureData: true,
      deliverySignatureData: true,
      uploadToken: true,
      quoteToken: true,
    })
    expect(res.headers.get("cache-control")).toContain("no-store")
  })

  it("la vista debt también omite los secretos en la página completa", async () => {
    mocks.auth.mockResolvedValue(session("ADMIN"))
    mocks.orderFindMany.mockResolvedValueOnce([
      { id: "o1", status: "READY", quoteCents: 1000, approvedQuoteCents: null, diagnosticFeeCents: null },
    ])
    const res = await workshopList(new Request("https://app.invalid/api/workshop?view=debt"))
    expect(res.status).toBe(200)
    const pageFetch = mocks.orderFindMany.mock.calls.at(-1)?.[0] as { include?: unknown; omit?: Record<string, boolean> }
    expect(pageFetch.include).toBeTruthy()
    expect(pageFetch.omit).toMatchObject({ deviceAccessValue: true, signatureData: true, deliverySignatureData: true, uploadToken: true, quoteToken: true })
  })

  it("view=mine solo trae las órdenes asignadas a quien consulta", async () => {
    mocks.auth.mockResolvedValue(session("EMPLOYEE"))
    const res = await workshopList(new Request("https://app.invalid/api/workshop?view=mine"))
    expect(res.status).toBe(200)
    const args = mocks.orderFindMany.mock.calls[0][0] as { where?: Record<string, unknown> }
    expect(args.where).toMatchObject({ businessId: "biz-1", assignedToId: "u-EMPLOYEE" })
  })

  it("view=mine se combina con el filtro de etapa (ambos aplican)", async () => {
    mocks.auth.mockResolvedValue(session("EMPLOYEE"))
    const res = await workshopList(new Request("https://app.invalid/api/workshop?view=mine&status=IN_REPAIR"))
    expect(res.status).toBe(200)
    const args = mocks.orderFindMany.mock.calls[0][0] as { where?: Record<string, unknown> }
    expect(args.where).toMatchObject({ assignedToId: "u-EMPLOYEE", status: "IN_REPAIR" })
  })

  it("sin view el admin ve todas las órdenes (sin filtro de asignación)", async () => {
    mocks.auth.mockResolvedValue(session("ADMIN"))
    const res = await workshopList(new Request("https://app.invalid/api/workshop"))
    expect(res.status).toBe(200)
    const args = mocks.orderFindMany.mock.calls[0][0] as { where?: Record<string, unknown> }
    expect(args.where).not.toHaveProperty("assignedToId")
  })

  it("view=mine es válida y las vistas desconocidas siguen en 400", async () => {
    mocks.auth.mockResolvedValue(session("ADMIN"))
    expect((await workshopList(new Request("https://app.invalid/api/workshop?view=mine"))).status).toBe(200)
    expect((await workshopList(new Request("https://app.invalid/api/workshop?view=fantasma"))).status).toBe(400)
  })
})

describe("GET /api/seguimiento (timeline público)", () => {
  const order = {
    number: 7, status: "IN_REPAIR", customerPhone: "5512341234",
    equipmentType: "Celular", brand: "Moto", model: "G",
    reportedIssue: "No enciende", promisedAt: null, createdAt: new Date(),
    approvedQuoteCents: null, quoteToken: "qt",
    currentBranch: { name: "Centro" },
    business: { name: "Taller", phone: null, isActive: true },
    events: [
      { id: "e1", type: "STATUS", detail: "Recibido → En diagnóstico. Responsable: Juan.", isPublic: false, createdAt: new Date() },
      { id: "e2", type: "NOTE", detail: "Tu equipo está listo para recoger.", isPublic: true, createdAt: new Date() },
      { id: "e3", type: "PAYMENT", detail: "Abono 500.00 MXN (CASH).", isPublic: false, createdAt: new Date() },
      { id: "e4", type: "STATUS", detail: "Entrega a: María García", isPublic: false, createdAt: new Date() },
    ],
    photos: [], payments: [], parts: [],
  }

  it("solo publica eventos isPublic — nunca status/pagos/notas internas", async () => {
    mocks.orderFindUnique.mockResolvedValue(order)
    const res = await seguimiento(new Request("https://app.invalid/api/seguimiento?folio=OT-000007&phone=1234", { headers: { "x-real-ip": nextIp() } }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.order.events).toHaveLength(1)
    expect(json.order.events[0].id).toBe("e2")
    expect(json.order.events[0].kind).toBe("MESSAGE")
    // Nada del detalle interno se filtra al cuerpo de la respuesta.
    const body = JSON.stringify(json)
    expect(body).not.toContain("María García")
    expect(body).not.toContain("Responsable")
    expect(body).not.toContain("500.00")
  })
})

describe("POST /api/cotizacion/[token]/approve", () => {
  it("rechaza aprobar un monto distinto al visto (409 QUOTE_CHANGED)", async () => {
    mocks.orderFindUnique.mockResolvedValue(pendingQuoteOrder)
    const res = await decideQuote(approveReq({ action: "APPROVE", expectedLaborCents: 99900 }), tokenParams)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe("QUOTE_CHANGED")
    expect(mocks.orderUpdateMany).not.toHaveBeenCalled()
  })

  it("aprueba cuando el monto visto coincide y fija IN_REPAIR", async () => {
    mocks.orderFindUnique.mockResolvedValue(pendingQuoteOrder)
    const res = await decideQuote(approveReq({ action: "APPROVE", expectedLaborCents: 150000, signerName: "Ana" }), tokenParams)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.decision).toBe("APPROVED")
    const update = mocks.orderUpdateMany.mock.calls[0][0] as { data: { status?: string; approvedQuoteCents?: number } }
    expect(update.data.status).toBe("IN_REPAIR")
    expect(update.data.approvedQuoteCents).toBe(150000)
  })

  it("exige expectedLaborCents en el body", async () => {
    mocks.orderFindUnique.mockResolvedValue(pendingQuoteOrder)
    const res = await decideQuote(approveReq({ action: "APPROVE" }), tokenParams)
    expect(res.status).toBe(400)
    expect(mocks.orderUpdateMany).not.toHaveBeenCalled()
  })

  it("rechaza decisiones fuera de WAITING_APPROVAL (estimado informal no se vuelve cobro)", async () => {
    for (const status of ["RECEIVED", "DIAGNOSIS", "IN_REPAIR", "READY"]) {
      mocks.orderFindUnique.mockResolvedValue({ ...pendingQuoteOrder, status, quoteCents: status === "RECEIVED" ? 50000 : 150000 })
      const res = await decideQuote(approveReq({ action: "APPROVE", expectedLaborCents: status === "RECEIVED" ? 50000 : 150000 }), tokenParams)
      expect(res.status).toBe(409)
    }
    expect(mocks.orderUpdateMany).not.toHaveBeenCalled()
  })

  it("rechazo en WAITING_APPROVAL fija NOT_AUTHORIZED", async () => {
    mocks.orderFindUnique.mockResolvedValue(pendingQuoteOrder)
    const res = await decideQuote(approveReq({ action: "REJECT", expectedLaborCents: 150000 }), tokenParams)
    expect(res.status).toBe(200)
    const update = mocks.orderUpdateMany.mock.calls[0][0] as { data: { status?: string } }
    expect(update.data.status).toBe("NOT_AUTHORIZED")
  })

  it("rechaza decidir una cotización vencida (410 QUOTE_EXPIRED)", async () => {
    mocks.orderFindUnique.mockResolvedValue({ ...pendingQuoteOrder, quoteExpiresAt: new Date(Date.now() - 60_000) })
    const res = await decideQuote(approveReq({ action: "APPROVE", expectedLaborCents: 150000 }), tokenParams)
    expect(res.status).toBe(410)
    const json = await res.json()
    expect(json.code).toBe("QUOTE_EXPIRED")
    expect(mocks.orderUpdateMany).not.toHaveBeenCalled()
  })

  it("una cotización decidida reporta \"ya fue decidida\" aunque esté vencida", async () => {
    mocks.orderFindUnique.mockResolvedValue({ ...pendingQuoteOrder, quoteApprovedAt: new Date(), quoteExpiresAt: new Date(Date.now() - 60_000) })
    const res = await decideQuote(approveReq({ action: "APPROVE", expectedLaborCents: 150000 }), tokenParams)
    expect(res.status).toBe(409)
    expect(mocks.orderUpdateMany).not.toHaveBeenCalled()
  })

  it("rechaza aprobar cuando las refacciones vistas no coinciden (409 QUOTE_CHANGED)", async () => {
    mocks.orderFindUnique.mockResolvedValue({
      ...pendingQuoteOrder,
      parts: [{ qty: 1, unitCostCents: 0, unitPriceCents: 30000, status: "APPROVED" }],
    })
    const res = await decideQuote(approveReq({ action: "APPROVE", expectedLaborCents: 150000, expectedPartsCents: 9999 }), tokenParams)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe("QUOTE_CHANGED")
    expect(mocks.orderUpdateMany).not.toHaveBeenCalled()
  })

  it("aprueba cuando mano de obra y refacciones coinciden con lo visto", async () => {
    mocks.orderFindUnique.mockResolvedValue({
      ...pendingQuoteOrder,
      parts: [{ qty: 2, unitCostCents: 0, unitPriceCents: 30000, status: "APPROVED" }],
    })
    const res = await decideQuote(approveReq({ action: "APPROVE", expectedLaborCents: 150000, expectedPartsCents: 60000 }), tokenParams)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.decision).toBe("APPROVED")
  })

  it("re-aprueba tras re-autorización por refacción nueva (quoteApprovedAt quedó en null)", async () => {
    // Estado que deja el dominio al aprobar una refacción post-autorización:
    // status WAITING_APPROVAL, quoteApprovedAt null, approvedQuoteCents
    // conserva la mano de obra ya pactada.
    mocks.orderFindUnique.mockResolvedValue({
      ...pendingQuoteOrder,
      approvedQuoteCents: 150000,
      parts: [{ qty: 1, unitCostCents: 0, unitPriceCents: 30000, status: "APPROVED" }],
    })
    const res = await decideQuote(approveReq({ action: "APPROVE", expectedLaborCents: 150000, expectedPartsCents: 30000 }), tokenParams)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.decision).toBe("APPROVED")
    const update = mocks.orderUpdateMany.mock.calls[0][0] as { where: { quoteApprovedAt: null }, data: { status?: string } }
    expect(update.where.quoteApprovedAt).toBeNull()
    expect(update.data.status).toBe("IN_REPAIR")
  })
})

describe("GET /api/cotizacion/[token]", () => {
  const doc = {
    number: 7, businessId: "biz-1", business: { isActive: true },
    status: "WAITING_APPROVAL", customerName: "Ana", equipmentType: "Celular",
    brand: "Moto", model: "G", equipmentColor: null, reportedIssue: "No enciende",
    diagnosis: null, quoteCents: 150000, approvedQuoteCents: null,
    quoteApprovedAt: null, createdAt: new Date(), parts: [], events: [],
  }

  it("devuelve 410 cuando la orden ya se entregó o canceló", async () => {
    for (const status of ["DELIVERED", "CANCELLED"]) {
      mocks.orderFindUnique.mockResolvedValue({ ...doc, status })
      const res = await quoteDoc(new Request("https://app.invalid/api/cotizacion/tok-1", { headers: { "x-real-ip": nextIp() } }), tokenParams)
      expect(res.status).toBe(410)
    }
  })

  it("sigue visible en estados activos", async () => {
    mocks.orderFindUnique.mockResolvedValue(doc)
    const res = await quoteDoc(new Request("https://app.invalid/api/cotizacion/tok-1", { headers: { "x-real-ip": nextIp() } }), tokenParams)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.quote.laborCents).toBe(150000)
  })

  it("devuelve 410 cuando la vigencia (quoteExpiresAt) ya pasó", async () => {
    mocks.orderFindUnique.mockResolvedValue({ ...doc, quoteExpiresAt: new Date(Date.now() - 60_000) })
    const res = await quoteDoc(new Request("https://app.invalid/api/cotizacion/tok-1", { headers: { "x-real-ip": nextIp() } }), tokenParams)
    expect(res.status).toBe(410)
    const json = await res.json()
    expect(json.error).toBe("Esta cotización venció.")
  })

  it("expone quoteExpiresAt y el total de refacciones (partsCents)", async () => {
    const expires = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
    mocks.orderFindUnique.mockResolvedValue({
      ...doc,
      quoteExpiresAt: expires,
      parts: [{ description: "Batería", qty: 2, unitPriceCents: 30000 }],
    })
    const res = await quoteDoc(new Request("https://app.invalid/api/cotizacion/tok-1", { headers: { "x-real-ip": nextIp() } }), tokenParams)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.quote.partsCents).toBe(60000)
    expect(json.quote.totalCents).toBe(210000)
  })
})

describe("evidencia de staff en /api/workshop/[id]/photos", () => {
  it("employee no puede borrar evidencia de una orden entregada", async () => {
    mocks.auth.mockResolvedValue(session("EMPLOYEE"))
    mocks.orderFindUnique.mockResolvedValue({ status: "DELIVERED" })
    const res = await deletePhoto(new Request("https://app.invalid/api/workshop/order-1/photos", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ photoId: "p1" }),
    }), idParams)
    expect(res.status).toBe(403)
    expect(mocks.photoFindFirst).not.toHaveBeenCalled()
  })

  it("admin sí puede borrar en orden entregada (garantía)", async () => {
    mocks.auth.mockResolvedValue(session("ADMIN"))
    mocks.orderFindUnique.mockResolvedValue({ status: "DELIVERED" })
    mocks.photoFindFirst.mockResolvedValue(null)
    const res = await deletePhoto(new Request("https://app.invalid/api/workshop/order-1/photos", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ photoId: "p1" }),
    }), idParams)
    // Pasó el guard de estado: falla solo porque la foto no existe (404).
    expect(res.status).toBe(404)
    expect(mocks.photoFindFirst).toHaveBeenCalled()
  })

  it("employee no puede subir evidencia a una orden cerrada", async () => {
    mocks.auth.mockResolvedValue(session("EMPLOYEE"))
    mocks.orderFindUnique.mockResolvedValue({ id: "order-1", status: "CANCELLED" })
    const res = await uploadPhoto(new Request("https://app.invalid/api/workshop/order-1/photos", { method: "POST" }), idParams)
    expect(res.status).toBe(403)
    expect(mocks.photoCreate).not.toHaveBeenCalled()
  })

  it("employee sí opera en órdenes abiertas", async () => {
    mocks.auth.mockResolvedValue(session("EMPLOYEE"))
    mocks.orderFindUnique.mockResolvedValue({ status: "IN_REPAIR" })
    mocks.photoFindFirst.mockResolvedValue({ id: "p1", label: null, filePath: "x" })
    mocks.photoDelete.mockResolvedValue({})
    const res = await deletePhoto(new Request("https://app.invalid/api/workshop/order-1/photos", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ photoId: "p1" }),
    }), idParams)
    expect(res.status).toBe(200)
  })
})
