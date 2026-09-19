import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import { delegateRepairToPartner } from "@/lib/domain/delegation"
import { updateRepair } from "@/lib/domain/workshop"

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

const events = () => tx.repairEvent.create.mock.calls.map(call => (call[0] as { data: { orderId: string; type: string; detail: string; isPublic: boolean } }).data)

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
