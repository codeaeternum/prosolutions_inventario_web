import { describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import { agingBuckets, paySupplier, supplierAging } from "@/lib/domain/supplier-payments"

const NOW = new Date("2025-06-15T12:00:00Z")
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)
const daysAhead = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000)

describe("agingBuckets", () => {
    it("clasifica por días de atraso y trata sin fecha / futura como corriente", () => {
        const buckets = agingBuckets([
            { remainingCents: 100, dueAt: null },          // corriente
            { remainingCents: 200, dueAt: daysAhead(5) },  // corriente
            { remainingCents: 300, dueAt: NOW },           // corriente (0 días)
            { remainingCents: 400, dueAt: daysAgo(1) },    // 1-15
            { remainingCents: 500, dueAt: daysAgo(15) },   // 1-15
            { remainingCents: 600, dueAt: daysAgo(16) },   // 16-30
            { remainingCents: 700, dueAt: daysAgo(30) },   // 16-30
            { remainingCents: 800, dueAt: daysAgo(31) },   // 31-60
            { remainingCents: 900, dueAt: daysAgo(60) },   // 31-60
            { remainingCents: 1000, dueAt: daysAgo(61) },  // 60+
        ], 0, NOW)
        expect(buckets).toEqual({ current: 600, d1_15: 900, d16_30: 1300, d31_60: 1700, d60plus: 1000 })
    })

    it("ignora deudas sin saldo", () => {
        const buckets = agingBuckets([{ remainingCents: 0, dueAt: daysAgo(90) }], 0, NOW)
        expect(buckets).toEqual({ current: 0, d1_15: 0, d16_30: 0, d31_60: 0, d60plus: 0 })
    })

    it("waterfall: el abono a cuenta general cubre primero el bucket más viejo", () => {
        const buckets = agingBuckets([
            { remainingCents: 1000, dueAt: daysAgo(90) }, // 60+
            { remainingCents: 1000, dueAt: daysAgo(40) }, // 31-60
            { remainingCents: 1000, dueAt: null },        // corriente
        ], 1500, NOW)
        expect(buckets).toEqual({ current: 1000, d1_15: 0, d16_30: 0, d31_60: 500, d60plus: 0 })
    })

    it("el excedente de abonos generales no genera buckets negativos", () => {
        const buckets = agingBuckets([{ remainingCents: 500, dueAt: null }], 900, NOW)
        expect(buckets).toEqual({ current: 0, d1_15: 0, d16_30: 0, d31_60: 0, d60plus: 0 })
    })
})

describe("supplierAging", () => {
    function fakeDb(opts: {
        suppliers: { id: string; name: string }[]
        purchases: { id: string; supplierId: string | null; totalCents: number; dueAt: Date | null; status: string }[]
        payments: { supplierId: string; purchaseId: string | null; amountCents: number }[]
    }) {
        return {
            supplier: { findMany: async () => opts.suppliers },
            purchase: {
                findMany: async ({ where }: { where: { status: { in: string[] } } }) =>
                    opts.purchases.filter(p => p.supplierId !== null && where.status.in.includes(p.status)),
            },
            supplierPayment: { findMany: async () => opts.payments },
        } as unknown as PrismaClient
    }

    it("calcula buckets por proveedor descontando abonos por OC y generales", async () => {
        const db = fakeDb({
            suppliers: [
                { id: "s1", name: "Beta" },
                { id: "s2", name: "Alfa" },
                { id: "s3", name: "Sin deuda" },
            ],
            purchases: [
                { id: "p1", supplierId: "s1", totalCents: 10000, dueAt: daysAgo(70), status: "RECEIVED" },
                { id: "p2", supplierId: "s1", totalCents: 5000, dueAt: null, status: "ORDERED" },
                { id: "p3", supplierId: "s2", totalCents: 8000, dueAt: daysAgo(10), status: "RECEIVED" },
                { id: "p4", supplierId: "s2", totalCents: 3000, dueAt: daysAgo(10), status: "DRAFT" },     // no pagadera
                { id: "p5", supplierId: "s2", totalCents: 2000, dueAt: daysAgo(45), status: "CANCELLED" }, // no pagadera
            ],
            payments: [
                { supplierId: "s1", purchaseId: "p1", amountCents: 4000 }, // p1 queda 6000 en 60+
                { supplierId: "s1", purchaseId: null, amountCents: 2500 }, // general: cubre 60+ primero
                { supplierId: "s2", purchaseId: "p5", amountCents: 2000 }, // OC cancelada → cuenta general
            ],
        })
        const { suppliers, totals } = await supplierAging(db, "biz-1", NOW)

        expect(suppliers.map(r => r.supplierId)).toEqual(["s2", "s1"]) // orden por nombre
        const s1 = suppliers.find(r => r.supplierId === "s1")!
        // p1: 10000-4000=6000 en 60+; p2: 5000 corriente; general 2500 cubre 60+ → 3500
        expect(s1).toMatchObject({ name: "Beta", current: 5000, d60plus: 3500, total: 8500 })
        const s2 = suppliers.find(r => r.supplierId === "s2")!
        // p3: 8000 en 1-15; pago a OC cancelada (2000) es general → cubre 1-15 → 6000
        expect(s2).toMatchObject({ name: "Alfa", d1_15: 6000, total: 6000 })
        expect(totals).toEqual({ current: 5000, d1_15: 6000, d16_30: 0, d31_60: 0, d60plus: 3500, total: 14500 })
    })

    it("excluye proveedores sin deuda o totalmente cubiertos por abonos", async () => {
        const db = fakeDb({
            suppliers: [{ id: "s1", name: "Cubierto" }],
            purchases: [{ id: "p1", supplierId: "s1", totalCents: 1000, dueAt: daysAgo(10), status: "RECEIVED" }],
            payments: [{ supplierId: "s1", purchaseId: null, amountCents: 5000 }],
        })
        const { suppliers, totals } = await supplierAging(db, "biz-1", NOW)
        expect(suppliers).toEqual([])
        expect(totals.total).toBe(0)
    })
})

describe("paySupplier — cashFromRegister", () => {
    const BIZ = "biz-supplier-pay"
    let seq = 0
    const key = () => `supplier-pay-${++seq}`

    /** Réplica del tx de operation() + paySupplier; caja con $10 registrados. */
    function fakeDb(opts: { registerOpen?: boolean; cashInCents?: number } = {}) {
        const created = { payments: [] as Record<string, unknown>[], cash: [] as Record<string, unknown>[] }
        const tx = {
            user: {
                findUnique: vi.fn(async () => ({ id: "admin-1", role: "ADMIN", status: "APPROVED", businessId: BIZ, homeBranchId: "branch-1" })),
            },
            supplier: { findFirst: vi.fn(async () => ({ id: "sup-1", name: "Proveedor", businessId: BIZ })) },
            supplierPayment: {
                create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.payments.push(data); return { id: "sp-1", ...data } }),
            },
            branch: {
                findFirst: vi.fn(async ({ where }: { where?: { id?: string } }) => ({ id: where?.id ?? "branch-1", name: "S1", isActive: true, businessId: BIZ })),
            },
            cashRegister: {
                findMany: vi.fn(async () => (opts.registerOpen === false ? [] : [{ id: "reg-1" }])),
                findUniqueOrThrow: vi.fn(async () => ({ id: "reg-1", initialAmount: 0 })),
                updateMany: vi.fn(async () => ({ count: 1 })),
            },
            cashMovement: {
                create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.cash.push(data); return { id: "cash-1", ...data } }),
                groupBy: vi.fn(async () => [{ type: "IN", _sum: { amount: (opts.cashInCents ?? 1000) / 100 } }]),
            },
            businessOperation: {
                findUnique: vi.fn(async () => null),
                create: vi.fn(async () => ({ id: "op-1" })),
                update: vi.fn(async () => ({})),
            },
        }
        const db = { $transaction: async (work: (t: unknown) => Promise<unknown>) => work(tx) }
        return { db: db as unknown as PrismaClient, tx, created }
    }

    it("CASH sin la marca solo documenta la salida (comportamiento histórico)", async () => {
        const { db, created } = fakeDb()
        const result = await paySupplier(db, "admin-1", BIZ, { supplierId: "sup-1", amountCents: 800, method: "CASH", idempotencyKey: key() })
        expect(created.cash).toHaveLength(0)
        expect(result.cashMovementId).toBeNull()
    })

    it("CASH con cashFromRegister asienta su OUT en la caja del cobrador", async () => {
        const { db, created } = fakeDb()
        const result = await paySupplier(db, "admin-1", BIZ, { supplierId: "sup-1", amountCents: 800, method: "CASH", cashFromRegister: true, idempotencyKey: key() })
        expect(created.cash[0]).toMatchObject({ type: "OUT", amount: 8, registerId: "reg-1", referenceType: "SUPPLIER_PAYMENT", referenceId: "sp-1" })
        expect(result.cashMovementId).toBe("cash-1")
    })

    it("la marca exige caja abierta y efectivo suficiente", async () => {
        const { db: noRegister } = fakeDb({ registerOpen: false })
        await expect(paySupplier(noRegister, "admin-1", BIZ, { supplierId: "sup-1", amountCents: 800, method: "CASH", cashFromRegister: true, idempotencyKey: key() }))
            .rejects.toMatchObject({ status: 409, code: "REGISTER_REQUIRED" })
        const { db: short } = fakeDb({ cashInCents: 500 })
        await expect(paySupplier(short, "admin-1", BIZ, { supplierId: "sup-1", amountCents: 800, method: "CASH", cashFromRegister: true, idempotencyKey: key() }))
            .rejects.toMatchObject({ status: 409, code: "INSUFFICIENT_CASH" })
    })

    it("la marca no aplica a medios no-efectivo", async () => {
        const { db, created } = fakeDb()
        await paySupplier(db, "admin-1", BIZ, { supplierId: "sup-1", amountCents: 800, method: "TRANSFER", cashFromRegister: true, idempotencyKey: key() })
        expect(created.cash).toHaveLength(0)
    })
})
