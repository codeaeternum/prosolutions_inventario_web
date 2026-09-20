import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import { delegateRepairToPartner } from "@/lib/domain/delegation"
import { updateRepair } from "@/lib/domain/workshop"

// El aviso espejo → origen carga estos canales con import perezoso post-commit
// (la ruta del stream tira de api-auth/next-auth y telegram de lib/prisma):
// se sustituyen para aislar el dominio y espiar qué se envía.
const notified = vi.hoisted(() => ({
  staff: vi.fn<(notification: unknown, businessId: string) => Promise<void>>(),
  telegram: vi.fn<(businessId: string, message: string, filter?: { role?: string }) => Promise<number>>(),
}))
vi.mock("@/app/api/notifications/stream/route", () => ({
  sendNotificationToStaff: notified.staff,
  sendNotificationToAdmins: vi.fn(async () => {}),
}))
vi.mock("@/lib/telegram", () => ({ sendTelegramToUsers: notified.telegram }))

/**
 * Delegación saliente: una orden propia del captador se envía al taller
 * asociado — se crea la espejo en el tenant reparador (createRepair con
 * origen = captador) y la local queda EXTERNAL_LAB + delegated*. El dominio
 * corre sobre un tx falso (db.$transaction entrega el mock) y las lecturas
 * fuera de transacción comparten los mismos mocks vía el spread de db.
 */

const CAPTOR = "biz-cap"
const REPAIRER = "biz-rep"
const localAdmin = { id: "admin-1", name: "Admin", role: "ADMIN", status: "APPROVED", businessId: CAPTOR }
const repairerStaff = { id: "u-rep", name: "Taller", role: "EMPLOYEE", status: "APPROVED", businessId: REPAIRER }

const tx = {
  user: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  businessOperation: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  repairOrder: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  repairEvent: { create: vi.fn() },
  repairPart: { findMany: vi.fn(), updateMany: vi.fn() },
  payment: { aggregate: vi.fn() },
  branch: { findFirst: vi.fn() },
  business: { findUnique: vi.fn() },
  systemSettings: { findUnique: vi.fn() },
}
const db = { ...tx, $transaction: vi.fn((work: (t: unknown) => unknown) => work(tx)) } as unknown as PrismaClient

const localOrder = (over: Record<string, unknown> = {}) => ({
  id: "o1", businessId: CAPTOR, number: 7, version: 1, status: "DIAGNOSIS",
  customerName: "Ana López", customerPhone: "8112345678", customerPhoneAlt: null, customerId: "cust-1",
  equipmentType: "Celular", brand: "Apple", model: "iPhone 13", serialNumber: "SN-1",
  reportedIssue: "No enciende", currentBranchId: "b1",
  quoteCents: null, approvedQuoteCents: null, diagnosticFeeCents: null,
  closedWithoutRepair: false, warrantyUntil: null, warrantyCount: 0,
  delegatedToBusinessId: null, delegatedOrderId: null, delegatedAt: null,
  ...over,
})
const mirrorRow = { id: "m1", number: 12, businessId: REPAIRER, status: "RECEIVED" as const }
// La espejo "ya existente" que la búsqueda por delegatedFromOrderId devuelve.
let existingMirror: unknown = null

const events = () => tx.repairEvent.create.mock.calls.map(call => (call[0] as { data: { businessId: string; orderId: string; actorId: string; type: string; detail: string; isPublic: boolean } }).data)

beforeEach(() => {
  vi.clearAllMocks()
  existingMirror = null
  // actor() corre dentro de las transacciones: staff del reparador para la
  // espejo (operation de createRepair), admin local para la marca.
  tx.user.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve(where.id === repairerStaff.id ? repairerStaff : localAdmin))
  tx.user.findMany.mockResolvedValue([]) // linkCustomerByPhone sin clientes
  tx.user.findFirst.mockResolvedValue(repairerStaff) // staff habilitado del reparador
  tx.businessOperation.findUnique.mockResolvedValue(null)
  tx.businessOperation.create.mockResolvedValue({ id: "op-1" })
  tx.businessOperation.update.mockResolvedValue({})
  // repairOrder.findFirst: la orden local se pide por id; la espejo existente
  // por delegatedFromOrderId (idempotencia tras marca fallida).
  tx.repairOrder.findFirst.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
    Promise.resolve(where.delegatedFromOrderId !== undefined ? existingMirror : localOrder()))
  tx.repairOrder.findUnique.mockResolvedValue(null)
  tx.repairOrder.create.mockImplementation(({ data }) =>
    Promise.resolve({ id: "m1", number: 12, businessId: REPAIRER, status: "RECEIVED", quoteCents: null, partnerPriceCents: null, ...data }))
  tx.repairOrder.update.mockResolvedValue({})
  tx.repairOrder.updateMany.mockResolvedValue({ count: 1 })
  tx.repairOrder.findUniqueOrThrow.mockImplementation(async () => localOrder())
  tx.repairEvent.create.mockResolvedValue({})
  tx.repairPart.findMany.mockResolvedValue([])
  tx.repairPart.updateMany.mockResolvedValue({ count: 0 })
  tx.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } })
  tx.branch.findFirst.mockResolvedValue({ id: "rb1", name: "Taller Centro" })
  tx.business.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve(where.id === REPAIRER ? { name: "Reparador SA", isActive: true } : { name: "Captador SA" }))
  tx.systemSettings.findUnique.mockImplementation(({ where }: { where: { businessId_key: { key: string } } }) =>
    Promise.resolve(where.businessId_key.key === "repair_partner_business_id" ? { value: REPAIRER } : null))
})

describe("delegar orden propia al taller asociado", () => {
  it("crea la espejo en el tenant reparador y marca la local como delegada", async () => {
    const result = await delegateRepairToPartner(db, "admin-1", CAPTOR, "o1", { partnerPriceCents: 35000, note: "Cliente con prisa" })
    expect(result).toMatchObject({ delegated: true, alreadyDelegated: false, mirrorOrderId: "m1", mirrorFolio: "OT-000012", partnerName: "Reparador SA" })
    // La espejo nace por createRepair en el tenant reparador con el captador
    // como origen y el folio local como contacto.
    const mirrorData = (tx.repairOrder.create.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(mirrorData).toMatchObject({
      businessId: REPAIRER,
      intakeBranchId: "rb1",
      originBusinessId: CAPTOR,
      originBusinessName: "Captador SA",
      originContact: "OT-000007",
      partnerPriceCents: 35000,
      serialNumber: "SN-1",
      createdById: "admin-1", // recordedById: quien delegó, no el staff reparador
    })
    // Vínculo inverso para la idempotencia.
    expect(tx.repairOrder.update).toHaveBeenCalledWith({ where: { id: "m1" }, data: { delegatedFromOrderId: "o1" } })
    // Marca local: EXTERNAL_LAB + delegated*.
    expect(tx.repairOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "o1", businessId: CAPTOR, delegatedOrderId: null }),
      data: expect.objectContaining({ status: "EXTERNAL_LAB", delegatedToBusinessId: REPAIRER, delegatedOrderId: "m1", delegatedAt: expect.any(Date) }),
    }))
    // Bitácora privada en la local + nota privada "Delegada desde" en la espejo.
    const local = events().find(e => e.orderId === "o1" && e.detail.includes("Enviada a taller asociado"))
    expect(local).toMatchObject({ isPublic: false, type: "NOTE" })
    expect(local?.detail).toContain("Reparador SA")
    expect(local?.detail).toContain("OT-000012")
    const mirrorNote = events().find(e => e.orderId === "m1" && e.detail.includes("Delegada desde OT-000007"))
    expect(mirrorNote?.isPublic).toBe(false)
    expect(mirrorNote?.detail).toContain("Cliente con prisa")
  })

  it("si la local ya está delegada devuelve la misma espejo sin duplicar", async () => {
    tx.repairOrder.findFirst.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(where.delegatedFromOrderId !== undefined ? null : localOrder({ delegatedOrderId: "m1", delegatedToBusinessId: REPAIRER })))
    tx.repairOrder.findUnique.mockResolvedValue(mirrorRow)
    const result = await delegateRepairToPartner(db, "admin-1", CAPTOR, "o1", {})
    expect(result).toMatchObject({ delegated: true, alreadyDelegated: true, mirrorOrderId: "m1", mirrorFolio: "OT-000012", partnerName: "Reparador SA" })
    expect(tx.repairOrder.create).not.toHaveBeenCalled()
    expect(tx.repairOrder.updateMany).not.toHaveBeenCalled()
  })

  it("si la espejo ya existe (la marca local falló antes) la reusa y solo completa la marca", async () => {
    existingMirror = mirrorRow
    const result = await delegateRepairToPartner(db, "admin-1", CAPTOR, "o1", {})
    expect(result).toMatchObject({ delegated: true, mirrorOrderId: "m1", mirrorFolio: "OT-000012" })
    expect(tx.repairOrder.create).not.toHaveBeenCalled()
    expect(tx.repairOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "EXTERNAL_LAB", delegatedOrderId: "m1" }),
    }))
  })

  it.each(["DELIVERED", "CANCELLED", "NOT_REPAIRED", "NOT_AUTHORIZED"])("rechaza delegar una orden cerrada (%s)", async status => {
    tx.repairOrder.findFirst.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(where.delegatedFromOrderId !== undefined ? null : localOrder({ status })))
    await expect(delegateRepairToPartner(db, "admin-1", CAPTOR, "o1", {})).rejects.toMatchObject({ status: 409 })
    expect(tx.repairOrder.create).not.toHaveBeenCalled()
    expect(tx.repairOrder.updateMany).not.toHaveBeenCalled()
  })

  it("sin taller asociado configurado pide configurarlo (400)", async () => {
    tx.systemSettings.findUnique.mockResolvedValue(null)
    await expect(delegateRepairToPartner(db, "admin-1", CAPTOR, "o1", {}))
      .rejects.toMatchObject({ status: 400, message: "Configura tu taller asociado en Configuración" })
    expect(tx.repairOrder.create).not.toHaveBeenCalled()
  })

  it("una orden de otro tenant (o inexistente) no se delega", async () => {
    tx.repairOrder.findFirst.mockResolvedValue(null)
    await expect(delegateRepairToPartner(db, "admin-1", CAPTOR, "o1", {})).rejects.toMatchObject({ status: 404 })
    expect(tx.repairOrder.create).not.toHaveBeenCalled()
  })
})

describe("guard de delegada en updateRepair", () => {
  // La delegada vive en EXTERNAL_LAB; desde ahí puede volver a IN_REPAIR —
  // las transiciones de etapa siguen abiertas, el dinero/stock no.
  const delegated = (over: Record<string, unknown> = {}) =>
    localOrder({ status: "EXTERNAL_LAB", delegatedOrderId: "m1", delegatedToBusinessId: REPAIRER, version: 3, ...over })
  const payload = (over: Record<string, unknown>) => ({ idempotencyKey: `deleg-test-${Math.random()}`, expectedVersion: 3, ...over })

  it.each(["PART_ADD", "PART_DECIDE", "PART_REMOVE", "PAYMENT", "SETTLE_DELIVER", "REFUND"] as const)(
    "bloquea %s sobre una orden delegada", async action => {
      tx.repairOrder.findUnique.mockResolvedValue(delegated())
      // REFUND exige detalle antes de llegar al guard — se envía para que el
      // rechazo que se evalúa sea el de la delegación, no el de validación.
      await expect(updateRepair(db, "admin-1", CAPTOR, "o1", payload({ action, detail: "x" })))
        .rejects.toMatchObject({ status: 409, message: "La orden fue delegada al taller asociado; cobra al cliente por POS y gestiona el trabajo en el portal aliado." })
      expect(tx.repairOrder.updateMany).not.toHaveBeenCalled()
    })

  it("las transiciones STATUS siguen permitidas sobre la delegada", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(delegated())
    tx.repairOrder.findUniqueOrThrow.mockResolvedValue(delegated({ status: "IN_REPAIR", version: 4 }))
    await updateRepair(db, "admin-1", CAPTOR, "o1", payload({ action: "STATUS", status: "IN_REPAIR" }))
    expect(tx.repairOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "IN_REPAIR" }),
    }))
  })

  it("al cancelar una delegada el evento advierte que la espejo sigue activa", async () => {
    // El taller ya la regresó (EXTERNAL_LAB → IN_REPAIR): desde IN_REPAIR la
    // cancelación sí es una transición válida.
    tx.repairOrder.findUnique.mockResolvedValue(delegated({ status: "IN_REPAIR" }))
    tx.repairOrder.findUniqueOrThrow.mockResolvedValue(delegated({ status: "CANCELLED", version: 4 }))
    await updateRepair(db, "admin-1", CAPTOR, "o1", payload({ action: "STATUS", status: "CANCELLED" }))
    const event = events().find(e => e.orderId === "o1" && e.type === "STATUS")
    expect(event?.detail).toContain("la orden espejo sigue activa en el taller asociado")
  })
})

describe("sincronización espejo → orden origen", () => {
  // La espejo vive en el tenant REPARADOR: updateRepair corre con staff del
  // taller y el aviso (evento + SSE + Telegram) debe caer en el tenant
  // captador, dueño de la orden origen apuntada por delegatedFromOrderId.
  const mirrorOrder = (over: Record<string, unknown> = {}) => ({
    id: "m1", businessId: REPAIRER, number: 12, version: 1, status: "IN_REPAIR",
    customerName: "Ana López", customerPhone: "8112345678", customerPhoneAlt: null, customerId: "cust-1",
    equipmentType: "Celular", brand: "Apple", model: "iPhone 13", serialNumber: "SN-1",
    reportedIssue: "No enciende", currentBranchId: "rb1",
    quoteCents: null, approvedQuoteCents: null, quoteApprovedAt: null, diagnosticFeeCents: null,
    closedWithoutRepair: false, warrantyUntil: null, warrantyCount: 0,
    delegatedToBusinessId: null, delegatedOrderId: null, delegatedAt: null,
    delegatedFromOrderId: "o1",
    ...over,
  })
  // La orden origen en el tenant captador (la lectura post-commit solo pide
  // estos campos; createdById es quien delegó — el actor del evento).
  const originRow = { id: "o1", businessId: CAPTOR, number: 7, createdById: "admin-1" }
  const mirrorPayload = (over: Record<string, unknown>) => ({ idempotencyKey: `mirror-${Math.random()}`, expectedVersion: 1, ...over })

  const mockMirror = (toStatus: string) => {
    // repairOrder.findUnique se usa dos veces: dentro de la tx lee la espejo
    // (m1) y post-commit el helper lee la origen (o1) — misma fn mock.
    tx.repairOrder.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(where.id === "m1" ? mirrorOrder() : where.id === "o1" ? originRow : null))
    tx.repairOrder.findUniqueOrThrow.mockResolvedValue(mirrorOrder({ status: toStatus, version: 2 }))
  }

  it("un STATUS sobre la espejo deja evento privado en la orden origen y avisa al captador", async () => {
    mockMirror("QUALITY_CHECK")
    const result = await updateRepair(db, repairerStaff.id, REPAIRER, "m1", mirrorPayload({ action: "STATUS", status: "QUALITY_CHECK" }))
    expect(result.order).toMatchObject({ id: "m1", status: "QUALITY_CHECK" })
    // Evento propio de la espejo (tenant reparador) — el de siempre.
    const mirrorEvent = events().find(e => e.orderId === "m1" && e.type === "STATUS")
    expect(mirrorEvent).toMatchObject({ businessId: REPAIRER, actorId: repairerStaff.id })
    // Evento privado en la ORIGEN: businessId del captador, actor = quien
    // delegó (createdById de la origen), nunca público.
    const originEvent = events().find(e => e.orderId === "o1" && e.detail.includes("taller asociado"))
    expect(originEvent).toMatchObject({ businessId: CAPTOR, actorId: "admin-1", type: "NOTE", isPublic: false })
    expect(originEvent?.detail).toBe("El taller asociado actualizó la orden OT-000012: En reparación → En revisión final.")
    // SSE al staff DEL CAPTADOR con folio origen y nombre del taller.
    expect(notified.staff).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "delegation_update",
        data: expect.objectContaining({ orderId: "o1", folio: "OT-000007", status: "En revisión final", mirrorFolio: "OT-000012", partnerName: "Reparador SA" }),
      }),
      CAPTOR,
    )
    // Telegram a los admins del captador.
    expect(notified.telegram).toHaveBeenCalledWith(
      CAPTOR,
      expect.stringContaining("Reparador SA"),
      { role: "ADMIN" },
    )
    expect(notified.telegram.mock.calls[0][1]).toContain("OT-000007")
    expect(notified.telegram.mock.calls[0][1]).toContain("En revisión final")
  })

  it("cualquier acción que mueva el status de la espejo sincroniza (QUOTE → WAITING_APPROVAL)", async () => {
    tx.repairOrder.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(where.id === "m1" ? mirrorOrder({ status: "DIAGNOSIS" }) : where.id === "o1" ? originRow : null))
    tx.repairOrder.findUniqueOrThrow.mockResolvedValue(mirrorOrder({ status: "WAITING_APPROVAL", version: 2 }))
    await updateRepair(db, repairerStaff.id, REPAIRER, "m1", mirrorPayload({ action: "QUOTE", detail: "Pantalla completa", quoteCents: 150000 }))
    const originEvent = events().find(e => e.orderId === "o1" && e.detail.includes("taller asociado"))
    expect(originEvent?.detail).toContain("En diagnóstico → Esperando autorización")
    expect(notified.staff).toHaveBeenCalledWith(expect.objectContaining({ type: "delegation_update" }), CAPTOR)
  })

  it.each([
    ["NOT_REPAIRED", "cancelada"],
    ["CANCELLED", "cancelada"],
  ])("un estado terminal de la espejo (%s) sugiere cerrar la local como %s sin cerrarla", async (toStatus, cierre) => {
    mockMirror(toStatus)
    await updateRepair(db, repairerStaff.id, REPAIRER, "m1", mirrorPayload({ action: "STATUS", status: toStatus }))
    const originEvent = events().find(e => e.orderId === "o1" && e.detail.includes("taller asociado"))
    expect(originEvent?.detail).toContain(`Puedes cerrar la orden local como ${cierre} desde su detalle.`)
    // La orden origen NO se toca: ningún update/updateMany apunta a "o1".
    expect(tx.repairOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "m1" }) }))
    expect(tx.repairOrder.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: "o1" } }))
  })

  it("si el aviso SSE/Telegram falla, el updateRepair de la espejo no se rompe", async () => {
    mockMirror("QUALITY_CHECK")
    notified.staff.mockRejectedValueOnce(new Error("stream caído"))
    notified.telegram.mockRejectedValueOnce(new Error("bot caído"))
    const result = await updateRepair(db, repairerStaff.id, REPAIRER, "m1", mirrorPayload({ action: "STATUS", status: "QUALITY_CHECK" }))
    expect(result.order).toMatchObject({ id: "m1", status: "QUALITY_CHECK" })
    // El evento privado en la origen sí quedó (corre antes de los canales).
    expect(events().some(e => e.orderId === "o1" && e.detail.includes("En reparación → En revisión final"))).toBe(true)
    expect(notified.staff).toHaveBeenCalledTimes(1)
    expect(notified.telegram).toHaveBeenCalledTimes(1)
  })

  it("una orden sin delegatedFromOrderId no genera evento ni aviso al captador", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(localOrder())
    tx.repairOrder.findUniqueOrThrow.mockResolvedValue(localOrder({ status: "EXTERNAL_LAB", version: 2 }))
    await updateRepair(db, "admin-1", CAPTOR, "o1", { idempotencyKey: `plain-${Math.random()}`, expectedVersion: 1, action: "STATUS", status: "EXTERNAL_LAB" })
    expect(events().some(e => e.detail.includes("taller asociado"))).toBe(false)
    expect(notified.staff).not.toHaveBeenCalled()
    expect(notified.telegram).not.toHaveBeenCalled()
    // Sin espejo no hay lectura post-commit de la origen: findUnique solo se
    // llamó una vez (la propia orden dentro de la transacción).
    expect(tx.repairOrder.findUnique).toHaveBeenCalledTimes(1)
  })
})
