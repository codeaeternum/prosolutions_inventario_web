import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient, RepairStatus } from "@prisma/client"
import { reconcileDelegations } from "@/lib/domain/delegation-reconcile"

/**
 * Barrido de reconciliación captador↔taller: prisma falso en memoria con dos
 * tablas (repairOrder / repairEvent) y un matcher que cubre solo los
 * operadores que usa delegation-reconcile (OR, not, in, gte, startsWith).
 */

const CAPTOR = "biz-cap"
const REPAIRER = "biz-rep"
const DAY = 24 * 60 * 60 * 1000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY)

type OrderRow = {
  id: string
  businessId: string
  number: number
  status: RepairStatus
  createdById: string
  delegatedOrderId: string | null
  delegatedToBusinessId: string | null
  delegatedFromOrderId: string | null
  updatedAt: Date
}
type EventRow = { id: string; businessId: string; orderId: string; actorId: string; type: string; detail: string; isPublic: boolean; createdAt: Date }

const order = (over: Partial<OrderRow>): OrderRow => ({
  id: "o1", businessId: CAPTOR, number: 7, status: "EXTERNAL_LAB", createdById: "admin-1",
  delegatedOrderId: null, delegatedToBusinessId: null, delegatedFromOrderId: null,
  updatedAt: new Date(),
  ...over,
})

function matchWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  if (!where) return true
  if (where.OR) return (where.OR as Record<string, unknown>[]).some(w => matchWhere(row, w))
  return Object.entries(where).every(([key, cond]) => {
    if (cond !== null && typeof cond === "object") {
      const c = cond as Record<string, unknown>
      if ("not" in c) return row[key] !== c.not
      if ("in" in c) return (c.in as unknown[]).includes(row[key])
      if ("gte" in c) return (row[key] as Date) >= (c.gte as Date)
      if ("startsWith" in c) return String(row[key] ?? "").startsWith(c.startsWith as string)
    }
    return row[key] === cond
  })
}

const orders: OrderRow[] = []
const events: EventRow[] = []
const eventCreate = vi.fn(async ({ data }: { data: Omit<EventRow, "id" | "createdAt"> }) => {
  const ev: EventRow = { id: `ev-${events.length + 1}`, createdAt: new Date(), ...data }
  events.push(ev)
  return ev
})
const db = {
  repairOrder: {
    findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
      orders.filter(row => matchWhere(row as unknown as Record<string, unknown>, where ?? {}))),
  },
  repairEvent: {
    findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
      events.filter(row => matchWhere(row as unknown as Record<string, unknown>, where ?? {}))),
    create: eventCreate,
  },
} as unknown as PrismaClient

const newEvents = () => events.filter(e => e.detail.startsWith("[delegation-reconcile]"))

beforeEach(() => {
  vi.clearAllMocks()
  eventCreate.mockImplementation(async ({ data }: { data: Omit<EventRow, "id" | "createdAt"> }) => {
    const ev: EventRow = { id: `ev-${events.length + 1}`, createdAt: new Date(), ...data }
    events.push(ev)
    return ev
  })
  orders.length = 0
  events.length = 0
})

describe("reconcileDelegations", () => {
  it("un vínculo sano (marca local + vínculo inverso) no reporta nada", async () => {
    orders.push(
      order({ id: "o1", delegatedOrderId: "m1", delegatedToBusinessId: REPAIRER }),
      order({ id: "m1", businessId: REPAIRER, number: 12, status: "IN_REPAIR", delegatedFromOrderId: "o1" }),
    )
    const result = await reconcileDelegations(db)
    expect(result).toMatchObject({ checked: 2, annotated: 0 })
    expect(result.issues).toHaveLength(0)
    expect(events).toHaveLength(0)
  })

  it("local marcada cuya espejo no existe → MIRROR_MISSING + alerta privada en la local", async () => {
    orders.push(order({ id: "o1", delegatedOrderId: "m-x", delegatedToBusinessId: REPAIRER }))
    const result = await reconcileDelegations(db)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatchObject({ kind: "MIRROR_MISSING", orderId: "o1", businessId: CAPTOR })
    expect(result.issues[0].detail).toContain("m-x")
    expect(result.annotated).toBe(1)
    const ev = newEvents()[0]
    expect(ev).toMatchObject({ businessId: CAPTOR, orderId: "o1", actorId: "admin-1", type: "NOTE", isPublic: false })
    expect(ev.detail).toContain("MIRROR_MISSING")
  })

  it("marca incompleta (delegatedToBusinessId sin delegatedOrderId) → MIRROR_MISSING", async () => {
    orders.push(order({ id: "o1", delegatedToBusinessId: REPAIRER }))
    const result = await reconcileDelegations(db)
    expect(result.issues[0].kind).toBe("MIRROR_MISSING")
  })

  it("espejo existe pero sin vínculo inverso → MIRROR_UNLINKED", async () => {
    orders.push(
      order({ id: "o1", delegatedOrderId: "m1", delegatedToBusinessId: REPAIRER }),
      order({ id: "m1", businessId: REPAIRER, number: 12, status: "RECEIVED" }),
    )
    const result = await reconcileDelegations(db)
    expect(result.issues.map(i => i.kind)).toEqual(["MIRROR_UNLINKED"])
    expect(result.issues[0].detail).toContain("delegatedFromOrderId=null")
  })

  it("la espejo vive en otro tenant → TENANT_MISMATCH", async () => {
    orders.push(
      order({ id: "o1", delegatedOrderId: "m1", delegatedToBusinessId: REPAIRER }),
      order({ id: "m1", businessId: "biz-otro", number: 12, status: "RECEIVED", delegatedFromOrderId: "o1" }),
    )
    const result = await reconcileDelegations(db)
    expect(result.issues.map(i => i.kind)).toContain("TENANT_MISMATCH")
  })

  it("espejo creada pero la origen jamás quedó marcada → ORIGIN_UNMARKED (el hueco entre commits)", async () => {
    orders.push(
      order({ id: "o1", status: "DIAGNOSIS" }),
      order({ id: "m1", businessId: REPAIRER, number: 12, status: "RECEIVED", delegatedFromOrderId: "o1" }),
    )
    const result = await reconcileDelegations(db)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatchObject({ kind: "ORIGIN_UNMARKED", orderId: "o1", businessId: CAPTOR })
    // La alerta cae en la orden ORIGEN (el captador es quien debe reintentar).
    expect(newEvents()[0].orderId).toBe("o1")
  })

  it("la origen apunta a otra espejo → DUPLICATE_MIRROR sobre la espejo sobrante", async () => {
    orders.push(
      order({ id: "o1", delegatedOrderId: "m1", delegatedToBusinessId: REPAIRER }),
      order({ id: "m1", businessId: REPAIRER, number: 12, status: "IN_REPAIR", delegatedFromOrderId: "o1" }),
      order({ id: "m2", businessId: REPAIRER, number: 13, status: "RECEIVED", delegatedFromOrderId: "o1" }),
    )
    const result = await reconcileDelegations(db)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatchObject({ kind: "DUPLICATE_MIRROR", orderId: "m2", businessId: REPAIRER })
    // La alerta se asienta en la espejo sobrante (tenant reparador).
    expect(newEvents()[0]).toMatchObject({ orderId: "m2", businessId: REPAIRER })
  })

  it("espejo cuyo origen no existe → MIRROR_ORPHAN (alerta en la propia espejo)", async () => {
    orders.push(order({ id: "m1", businessId: REPAIRER, number: 12, status: "RECEIVED", delegatedFromOrderId: "gone" }))
    const result = await reconcileDelegations(db)
    expect(result.issues[0]).toMatchObject({ kind: "MIRROR_ORPHAN", orderId: "m1" })
    expect(newEvents()[0]).toMatchObject({ orderId: "m1", businessId: REPAIRER })
  })

  it("origen cerrada + espejo abierta sin moverse > staleDays → STATUS_DIVERGENT", async () => {
    orders.push(
      order({ id: "o1", status: "DELIVERED", delegatedOrderId: "m1", delegatedToBusinessId: REPAIRER }),
      order({ id: "m1", businessId: REPAIRER, number: 12, status: "IN_REPAIR", delegatedFromOrderId: "o1", updatedAt: daysAgo(10) }),
    )
    const result = await reconcileDelegations(db)
    expect(result.issues.map(i => i.kind)).toEqual(["STATUS_DIVERGENT"])
    expect(result.issues[0].detail).toContain("Entregado")
    expect(result.issues[0].detail).toContain("En reparación")
  })

  it("espejo cerrada + local abierta sin moverse > staleDays → STATUS_DIVERGENT", async () => {
    orders.push(
      order({ id: "o1", status: "EXTERNAL_LAB", delegatedOrderId: "m1", delegatedToBusinessId: REPAIRER, updatedAt: daysAgo(9) }),
      order({ id: "m1", businessId: REPAIRER, number: 12, status: "DELIVERED", delegatedFromOrderId: "o1", updatedAt: daysAgo(9) }),
    )
    const result = await reconcileDelegations(db)
    expect(result.issues.map(i => i.kind)).toEqual(["STATUS_DIVERGENT"])
  })

  it("divergencia reciente (< staleDays) no se reporta todavía", async () => {
    orders.push(
      order({ id: "o1", status: "DELIVERED", delegatedOrderId: "m1", delegatedToBusinessId: REPAIRER }),
      order({ id: "m1", businessId: REPAIRER, number: 12, status: "IN_REPAIR", delegatedFromOrderId: "o1", updatedAt: daysAgo(1) }),
    )
    const result = await reconcileDelegations(db)
    expect(result.issues).toHaveLength(0)
  })

  it("la alerta se deduplica 24h: un aviso reciente con el TAG no se repite", async () => {
    orders.push(order({ id: "o1", delegatedOrderId: "m-x", delegatedToBusinessId: REPAIRER }))
    events.push({ id: "ev-0", businessId: CAPTOR, orderId: "o1", actorId: "admin-1", type: "NOTE", detail: "[delegation-reconcile] MIRROR_MISSING: previo", isPublic: false, createdAt: new Date() })
    const result = await reconcileDelegations(db)
    expect(result.issues).toHaveLength(1)
    expect(result.annotated).toBe(0)
    expect(newEvents()).toHaveLength(1) // solo el previo
  })

  it("annotate:false reporta sin escribir eventos (modo seco)", async () => {
    orders.push(order({ id: "o1", delegatedOrderId: "m-x", delegatedToBusinessId: REPAIRER }))
    const result = await reconcileDelegations(db, { annotate: false })
    expect(result.issues).toHaveLength(1)
    expect(result.annotated).toBe(0)
    expect(events).toHaveLength(0)
  })

  it("un evento que no se puede crear no aborta el barrido", async () => {
    orders.push(order({ id: "o1", delegatedOrderId: "m-x", delegatedToBusinessId: REPAIRER }))
    eventCreate.mockRejectedValueOnce(new Error("FK rota"))
    const result = await reconcileDelegations(db)
    expect(result.issues).toHaveLength(1)
    expect(result.annotated).toBe(0)
  })

  it("checked cuenta locales marcadas + espejos con vínculo inverso", async () => {
    orders.push(
      order({ id: "o1", delegatedOrderId: "m1", delegatedToBusinessId: REPAIRER }),
      order({ id: "m1", businessId: REPAIRER, number: 12, status: "READY", delegatedFromOrderId: "o1" }),
      order({ id: "o2", number: 8, status: "DIAGNOSIS" }), // sin delegar: no cuenta
    )
    const result = await reconcileDelegations(db)
    expect(result.checked).toBe(2)
    expect(result.issues).toHaveLength(0)
  })
})
