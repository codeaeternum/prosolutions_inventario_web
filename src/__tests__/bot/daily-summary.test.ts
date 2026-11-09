import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import type { BotContext } from "@/bot/lib/types"

// El cron queda doblado: se verifica expresión/timezone y se dispara el tick
// a mano sin esperar al reloj.
const scheduleMock = vi.hoisted(() =>
    vi.fn<(expr?: string, fn?: unknown, opts?: unknown) => { stop: () => void; destroy: () => void }>(
        () => ({ stop: vi.fn(), destroy: vi.fn() })))
vi.mock("node-cron", () => ({ schedule: scheduleMock }))

import {
    buildDailySummary,
    formatDailySummaryMessage,
    registerDailySummary,
    sendDailySummaryToAdmins,
    type DailySummaryDb,
} from "@/bot/commands/daily-summary"

// 20:00 del 6-feb-2025 en America/Mexico_City (UTC-6; sin DST desde 2023):
// el día-negocio corre de 06:00Z a 06:00Z del día siguiente.
const NOW = new Date("2025-02-06T20:00:00-06:00")
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

interface DbOverrides {
    sales?: { total: number; discountCents: number }[]
    delivered?: number
    registers?: { id: string; initialAmount: number }[]
    movements?: { amount: number; type: string }[]
    clockEvents?: { id: string; userId: string; type: string; at: Date; branchId: string | null; user: { name: string } }[]
    encargos?: number
    reservations?: number
    admins?: { name: string; telegramId: string | null }[]
    businesses?: { id: string; name: string }[]
}

function makeDb(o: DbOverrides = {}) {
    const mocks = {
        saleFindMany: vi.fn<(q?: any) => Promise<any>>(async () => o.sales ?? []),
        repairOrderCount: vi.fn<(q?: any) => Promise<number>>(async () => o.delivered ?? 0),
        cashRegisterFindMany: vi.fn<(q?: any) => Promise<any>>(async () => o.registers ?? []),
        cashMovementFindMany: vi.fn<(q?: any) => Promise<any>>(async () => o.movements ?? []),
        clockEventFindMany: vi.fn<(q?: any) => Promise<any>>(async () => o.clockEvents ?? []),
        encargoCount: vi.fn<(q?: any) => Promise<number>>(async () => o.encargos ?? 0),
        reservationCount: vi.fn<(q?: any) => Promise<number>>(async () => o.reservations ?? 0),
        userFindMany: vi.fn<(q?: any) => Promise<any>>(async () => o.admins ?? []),
        businessFindMany: vi.fn<(q?: any) => Promise<any>>(async () => o.businesses ?? []),
    }
    const db = {
        sale: { findMany: mocks.saleFindMany },
        repairOrder: { count: mocks.repairOrderCount },
        cashRegister: { findMany: mocks.cashRegisterFindMany },
        cashMovement: { findMany: mocks.cashMovementFindMany },
        clockEvent: { findMany: mocks.clockEventFindMany },
        encargo: { count: mocks.encargoCount },
        reservation: { count: mocks.reservationCount },
        user: { findMany: mocks.userFindMany },
        business: { findMany: mocks.businessFindMany },
    } as unknown as DailySummaryDb & PrismaClient
    return { db, mocks }
}

const makeBot = () => ({ telegram: { sendMessage: vi.fn(async () => ({})) } })

const clockIn = (id: string, userId: string, name: string, at: Date) =>
    ({ id, userId, type: "IN", at, branchId: null, user: { name } })
const clockOut = (id: string, userId: string, name: string, at: Date) =>
    ({ id, userId, type: "OUT", at, branchId: null, user: { name } })

describe("buildDailySummary", () => {
    it("suma las ventas COMPLETED del día en centavos (total − descuento) y las formatea en MXN", async () => {
        const { db, mocks } = makeDb({
            sales: [
                { total: 1000, discountCents: 0 },
                { total: 500.5, discountCents: 5000 }, // $500.50 − $50.00 de descuento
            ],
        })
        const s = await buildDailySummary(db, "biz-1", NOW)
        expect(s.sales).toEqual({ count: 2, totalCents: 145050 })
        expect(s.lines.join("\n")).toContain("$1,450.50")
        // Filtro tenant + día-negocio MX: solo COMPLETED desde las 00:00 MX.
        const where = (mocks.saleFindMany.mock.calls[0]?.[0] as { where: Record<string, any> }).where
        expect(where.businessId).toBe("biz-1")
        expect(where.status).toBe("COMPLETED")
        expect((where.createdAt as { gte: Date }).gte).toEqual(new Date("2025-02-06T06:00:00.000Z"))
    })

    it("sin ventas reporta 'Sin ventas hoy'", async () => {
        const { db } = makeDb({ sales: [] })
        const s = await buildDailySummary(db, "biz-1", NOW)
        expect(s.sales).toEqual({ count: 0, totalCents: 0 })
        expect(s.lines.join("\n")).toContain("Sin ventas hoy")
    })

    it("detecta un turno abierto >10h y nombra al usuario", async () => {
        const { db } = makeDb({
            clockEvents: [clockIn("e1", "u1", "María", hoursAgo(11))], // IN sin OUT hace 11 h
        })
        const s = await buildDailySummary(db, "biz-1", NOW)
        expect(s.openLongShifts).toBe(1)
        expect(s.longShiftNames).toEqual(["María"])
        const warn = s.lines.find(l => l.includes("Turnos abiertos"))
        expect(warn).toBeDefined()
        expect(warn).toContain("⚠️")
        expect(warn).toContain("María")
    })

    it("un turno CERRADO de 11 h no cuenta como turno largo", async () => {
        const { db } = makeDb({
            clockEvents: [
                clockIn("e1", "u1", "María", hoursAgo(15)),
                clockOut("e2", "u1", "María", hoursAgo(4)), // jornada cerrada de 11 h
            ],
        })
        const s = await buildDailySummary(db, "biz-1", NOW)
        expect(s.openLongShifts).toBe(0)
        expect(s.lines.join("\n")).not.toContain("Turnos abiertos")
    })

    it("suma initialAmount + IN − OUT de las cajas abiertas", async () => {
        const { db } = makeDb({
            registers: [{ id: "r1", initialAmount: 500 }],
            movements: [
                { amount: 200, type: "IN" },
                { amount: 50.25, type: "OUT" },
            ],
        })
        const s = await buildDailySummary(db, "biz-1", NOW)
        expect(s.cash).toEqual({ openRegisters: 1, expectedCents: 64975 })
        expect(s.lines.join("\n")).toContain("$649.75")
    })
})

describe("sendDailySummaryToAdmins", () => {
    beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}))

    it("negocio sin admins con telegramId → no intenta enviar nada", async () => {
        const { db, mocks } = makeDb({ admins: [] })
        const bot = makeBot()
        const sent = await sendDailySummaryToAdmins(bot as any, db, "biz-1", "mensaje")
        expect(sent).toBe(0)
        expect(bot.telegram.sendMessage).not.toHaveBeenCalled()
        // La consulta queda limitada al tenant y a admins aprobados con Telegram.
        expect(mocks.userFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { businessId: "biz-1", role: "ADMIN", status: "APPROVED", telegramId: { not: null } },
        }))
    })

    it("un envío fallido no detiene al siguiente admin", async () => {
        const { db } = makeDb({
            admins: [
                { name: "Ana", telegramId: "111" },
                { name: "Beto", telegramId: "222" },
            ],
        })
        const bot = makeBot()
        bot.telegram.sendMessage
            .mockRejectedValueOnce(new Error("chat blocked"))
            .mockResolvedValueOnce({})
        const sent = await sendDailySummaryToAdmins(bot as any, db, "biz-1", "mensaje")
        expect(bot.telegram.sendMessage).toHaveBeenCalledTimes(2)
        expect(bot.telegram.sendMessage).toHaveBeenNthCalledWith(2, "222", "mensaje", expect.objectContaining({ parse_mode: "HTML" }))
        expect(sent).toBe(1)
        expect(console.warn).toHaveBeenCalled()
    })
})

describe("formatDailySummaryMessage", () => {
    it("escapa el nombre del negocio en HTML y abre con el encabezado", async () => {
        const { db } = makeDb({})
        const s = await buildDailySummary(db, "biz-1", NOW)
        const msg = formatDailySummaryMessage("A&B <Taller>", s, NOW)
        expect(msg).toContain("Resumen del día — A&amp;B &lt;Taller&gt;")
        expect(msg).toContain("📊")
    })
})

describe("registerDailySummary", () => {
    beforeEach(() => scheduleMock.mockClear())

    it("programa el resumen a las 20:00 America/Mexico_City", () => {
        const { db } = makeDb({})
        const bot = makeBot()
        registerDailySummary({ bot, prisma: db, isDev: false } as unknown as BotContext)
        expect(scheduleMock).toHaveBeenCalledWith("0 20 * * *", expect.any(Function), { timezone: "America/Mexico_City" })
    })

    it("el tick envía el resumen a los admins de negocios activos solamente", async () => {
        const { db, mocks } = makeDb({
            businesses: [{ id: "biz-1", name: "Taller Uno" }],
            sales: [{ total: 100, discountCents: 0 }],
            admins: [{ name: "Ana", telegramId: "111" }],
        })
        const bot = makeBot()
        registerDailySummary({ bot, prisma: db, isDev: false } as unknown as BotContext)
        const tick = scheduleMock.mock.calls[0]?.[1] as unknown as () => Promise<void>
        await tick()
        expect(mocks.businessFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true } }))
        expect(bot.telegram.sendMessage).toHaveBeenCalledTimes(1)
        const [chatId, text] = bot.telegram.sendMessage.mock.calls[0] as unknown as [string, string]
        expect(chatId).toBe("111")
        expect(text).toContain("Resumen del día — Taller Uno")
        expect(text).toContain("$100.00")
    })
})
