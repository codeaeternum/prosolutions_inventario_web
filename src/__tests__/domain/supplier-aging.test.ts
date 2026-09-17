import { describe, expect, it } from "vitest"
import type { PrismaClient } from "@prisma/client"
import { agingBuckets, supplierAging } from "@/lib/domain/supplier-payments"

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
