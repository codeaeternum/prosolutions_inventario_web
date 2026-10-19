import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import { createRepair } from "@/lib/domain/workshop"

/**
 * Talleres aliados en createRepair: los campos de origen (tenant ligado o
 * captura de mostrador) se persisten en la orden, la bitácora del aliado es
 * PRIVADA (nunca sale en el rastreo público) y recordedById deja a la persona
 * que capturó como "Recibió" aunque el actor de la operación sea otro.
 */

const tx = {
  user: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  businessOperation: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  repairOrder: { create: vi.fn() },
  repairEvent: { create: vi.fn() },
  branch: { findFirst: vi.fn() },
  business: { findUnique: vi.fn() },
}
const db = { $transaction: vi.fn((work: (t: unknown) => unknown) => work(tx)) } as unknown as PrismaClient

// Staff del tenant reparador: la operación exige actor del mismo negocio.
const staff = { id: "u-staff", name: "Mostrador", role: "EMPLOYEE", status: "APPROVED", businessId: "biz-repairer" }
const baseInput = {
  idempotencyKey: "op-create-1",
  customerName: "Ana López",
  customerPhone: "8112345678",
  equipmentType: "Celular",
  reportedIssue: "No enciende",
  intakeBranchId: "b1",
}
const events = () => tx.repairEvent.create.mock.calls.map(call => (call[0] as { data: { type: string; detail: string; isPublic: boolean; actorId: string } }).data)

beforeEach(() => {
  vi.clearAllMocks()
  tx.user.findUnique.mockResolvedValue(staff)
  tx.user.findMany.mockResolvedValue([]) // sin cliente del directorio que ligar
  tx.businessOperation.findUnique.mockResolvedValue(null)
  tx.businessOperation.create.mockResolvedValue({ id: "op-1" })
  tx.businessOperation.update.mockResolvedValue({})
  tx.branch.findFirst.mockResolvedValue({ id: "b1", name: "Centro" })
  // El origen ligado se valida contra Business: cualquier id distinto del
  // propio tenant resuelve una fila (los tests de rechazo lo sobrescriben).
  tx.business.findUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve({ id: where.id }))
  // Eco del data recibido: lo que el dominio escribió es lo que regresa la fila.
  tx.repairOrder.create.mockImplementation(({ data }) => Promise.resolve({ id: "o1", number: 9, quoteCents: null, approvedQuoteCents: null, partnerPriceCents: null, ...data }))
  tx.repairEvent.create.mockResolvedValue({})
})

describe("origen de taller aliado", () => {
  it("persiste nombre, contacto y precio convenio capturados de mostrador", async () => {
    await createRepair(db, "u-staff", "biz-repairer", {
      ...baseInput,
      originBusinessName: "Telcel Centro",
      originContact: "Marisol · 667 123 4567",
      partnerPriceCents: 35000,
    })
    const data = (tx.repairOrder.create.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data).toMatchObject({
      originBusinessName: "Telcel Centro",
      originContact: "Marisol · 667 123 4567",
      partnerPriceCents: 35000,
      businessId: "biz-repairer",
      createdById: "u-staff",
    })
    // El convenio no es la cotización del cliente: approvedQuoteCents no se toca.
    expect(data.approvedQuoteCents).toBeUndefined()
  })

  it("deja evento PRIVADO 'Captado por … · convenio …' — jamás público", async () => {
    await createRepair(db, "u-staff", "biz-repairer", {
      ...baseInput, originBusinessName: "Telcel Centro", partnerPriceCents: 35000,
    })
    const origin = events().find(event => event.detail.includes("Captado por"))
    expect(origin).toBeDefined()
    expect(origin?.type).toBe("NOTE")
    expect(origin?.isPublic).toBe(false)
    expect(origin?.detail).toBe("Captado por Telcel Centro · convenio 350.00 MXN")
  })

  it("sin precio convenio el evento solo nombra al negocio", async () => {
    await createRepair(db, "u-staff", "biz-repairer", { ...baseInput, originBusinessName: "Telcel Sur" })
    const origin = events().find(event => event.detail.includes("Captado por"))
    expect(origin?.detail).toBe("Captado por Telcel Sur")
    expect(origin?.detail).not.toContain("convenio")
  })

  it("sin origen aliado no se crea la nota privada", async () => {
    await createRepair(db, "u-staff", "biz-repairer", baseInput)
    expect(events().some(event => event.detail.includes("Captado por"))).toBe(false)
  })

  it("el tenant ligado viaja como originBusinessId", async () => {
    await createRepair(db, "u-staff", "biz-repairer", {
      ...baseInput,
      originBusinessId: "biz-aliado",
      originBusinessName: "Taller Aliado SA",
    })
    const data = (tx.repairOrder.create.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data.originBusinessId).toBe("biz-aliado")
  })

  it("originBusinessId igual al negocio receptor se rechaza (400)", async () => {
    // Auto-referencia sin sentido: el captador y el reparador no pueden ser
    // el mismo tenant.
    await expect(createRepair(db, "u-staff", "biz-repairer", { ...baseInput, originBusinessId: "biz-repairer" }))
      .rejects.toMatchObject({ status: 400, message: "El negocio de origen no puede ser el mismo negocio." })
    expect(tx.repairOrder.create).not.toHaveBeenCalled()
  })

  it("originBusinessId inexistente se rechaza (400) en vez de reventar la FK", async () => {
    // Sin la validación el id basura llegaba al create y Prisma respondía
    // P2003 → 500.
    tx.business.findUnique.mockResolvedValue(null)
    await expect(createRepair(db, "u-staff", "biz-repairer", { ...baseInput, originBusinessId: "biz-fantasma" }))
      .rejects.toMatchObject({ status: 400, message: "El negocio de origen no existe." })
    expect(tx.repairOrder.create).not.toHaveBeenCalled()
  })
})

describe("recordedById (intake del aliado)", () => {
  it("createdById y actor de eventos registran a quien capturó, no al actor de la operación", async () => {
    await createRepair(db, "u-staff", "biz-repairer", { ...baseInput, originBusinessId: "biz-aliado" }, { recordedById: "u-partner" })
    const data = (tx.repairOrder.create.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data.createdById).toBe("u-partner")
    expect(events().every(event => event.actorId === "u-partner")).toBe(true)
  })

  it("privateNote queda como evento privado del canal", async () => {
    await createRepair(db, "u-staff", "biz-repairer", baseInput, { recordedById: "u-partner", privateNote: "Nota del negocio aliado: cliente con prisa" })
    const note = events().find(event => event.detail.includes("Nota del negocio aliado"))
    expect(note?.isPublic).toBe(false)
    expect(note?.actorId).toBe("u-partner")
  })

  it("sin opts el actor de la operación sigue siendo quien recibió", async () => {
    await createRepair(db, "u-staff", "biz-repairer", baseInput)
    const data = (tx.repairOrder.create.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data.createdById).toBe("u-staff")
    expect(events().every(event => event.actorId === "u-staff")).toBe(true)
  })
})

describe("validación de campos aliados", () => {
  it("originBusinessName no acepta más de 80 caracteres", async () => {
    await expect(createRepair(db, "u-staff", "biz-repairer", { ...baseInput, originBusinessName: "n".repeat(81) })).rejects.toThrow()
    expect(tx.repairOrder.create).not.toHaveBeenCalled()
  })

  it("originContact no acepta más de 120 caracteres", async () => {
    await expect(createRepair(db, "u-staff", "biz-repairer", { ...baseInput, originContact: "c".repeat(121) })).rejects.toThrow()
    expect(tx.repairOrder.create).not.toHaveBeenCalled()
  })

  it("partnerPriceCents rechaza negativos y fracciones", async () => {
    await expect(createRepair(db, "u-staff", "biz-repairer", { ...baseInput, partnerPriceCents: -100 })).rejects.toThrow()
    await expect(createRepair(db, "u-staff", "biz-repairer", { ...baseInput, partnerPriceCents: 100.5 })).rejects.toThrow()
    expect(tx.repairOrder.create).not.toHaveBeenCalled()
  })
})
