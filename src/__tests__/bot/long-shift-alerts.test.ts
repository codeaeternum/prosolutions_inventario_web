import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import type { BotContext } from "@/bot/lib/types"

// El cron queda doblado: se verifica expresión/opciones y se dispara el tick
// a mano sin esperar al reloj.
const scheduleMock = vi.hoisted(() =>
    vi.fn<(expr?: string, fn?: unknown, opts?: unknown) => { stop: () => void; destroy: () => void }>(
        () => ({ stop: vi.fn(), destroy: vi.fn() })))
vi.mock("node-cron", () => ({ schedule: scheduleMock }))

import {
    findLongOpenShifts,
    formatLongShiftMessage,
    formatShiftStart,
    LONG_SHIFT_NOTIFICATION_TYPE,
    registerLongShiftAlerts,
    runLongShiftAlerts,
    sendLongShiftAlerts,
    type LongOpenShift,
    type LongShiftDb,
} from "@/bot/commands/long-shift-alerts"

// 20:15 del 6-feb-2025 en America/Mexico_City (UTC-6): un IN hace 11 h cae a
// las 09:15 MX del mismo día-negocio.
const NOW = new Date("2025-02-06T20:15:00-06:00")
const hoursAgo = (h: number, from: Date = NOW) => new Date(from.getTime() - h * 3_600_000)

type ClockRow = {
    id: string
    userId: string
    type: string
    at: Date
    branchId: string | null
    user: { name: string; telegramId: string | null; status: string }
}

interface DbOverrides {
    businesses?: { id: string; name: string; isActive: boolean }[]
    clockEvents?: ClockRow[]
    /** Lo que notification.findFirst devuelve (fila = ya alertada la jornada). */
    notification?: { id: string } | null
}

function makeDb(o: DbOverrides = {}) {
    const mocks = {
        businessFindMany: vi.fn<(q?: any) => Promise<any>>(async () => o.businesses ?? []),
        clockEventFindMany: vi.fn<(q?: any) => Promise<any>>(async () => o.clockEvents ?? []),
        notificationFindFirst: vi.fn<(q?: any) => Promise<any>>(async () => o.notification ?? null),
        notificationCreate: vi.fn<(q?: any) => Promise<any>>(async () => ({ id: "n-new" })),
    }
    const db = {
        business: { findMany: mocks.businessFindMany },
        clockEvent: { findMany: mocks.clockEventFindMany },
        notification: { findFirst: mocks.notificationFindFirst, create: mocks.notificationCreate },
    } as unknown as LongShiftDb & PrismaClient
    return { db, mocks }
}

const makeBot = () => ({ telegram: { sendMessage: vi.fn(async () => ({})) } })

const ACTIVE_BIZ = { id: "biz-1", name: "Taller Uno", isActive: true }

const clockIn = (id: string, userId: string, at: Date, user: Partial<ClockRow["user"]> = {}): ClockRow =>
    ({ id, userId, type: "IN", at, branchId: null, user: { name: "María", telegramId: "tg-1", status: "APPROVED", ...user } })
const clockOut = (id: string, userId: string, at: Date, user: Partial<ClockRow["user"]> = {}): ClockRow =>
    ({ id, userId, type: "OUT", at, branchId: null, user: { name: "María", telegramId: "tg-1", status: "APPROVED", ...user } })

const makeShift = (over: Partial<LongOpenShift> = {}): LongOpenShift => ({
    businessId: "biz-1",
    businessName: "Taller Uno",
    userId: "u1",
    name: "María",
    telegramId: "tg-1",
    since: hoursAgo(11),
    elapsedMin: 660,
    ...over,
})

describe("findLongOpenShifts", () => {
    it("IN hace 11 h sin OUT → jornada larga detectada con ~660 min", async () => {
        const { db } = makeDb({
            businesses: [ACTIVE_BIZ],
            clockEvents: [clockIn("e1", "u1", hoursAgo(11))],
        })
        const shifts = await findLongOpenShifts(db, NOW)
        expect(shifts).toHaveLength(1)
        expect(shifts[0]).toMatchObject({
            businessId: "biz-1",
            userId: "u1",
            name: "María",
            telegramId: "tg-1",
            elapsedMin: 660,
        })
        expect(shifts[0].since).toEqual(hoursAgo(11))
    })

    it("IN hace 4 h → todavía no es jornada larga", async () => {
        const { db } = makeDb({
            businesses: [ACTIVE_BIZ],
            clockEvents: [clockIn("e1", "u1", hoursAgo(4))],
        })
        expect(await findLongOpenShifts(db, NOW)).toHaveLength(0)
    })

    it("IN hace 17 h sin OUT → jornada abandonada, no se persigue", async () => {
        const { db } = makeDb({
            businesses: [ACTIVE_BIZ],
            clockEvents: [clockIn("e1", "u1", hoursAgo(17))],
        })
        expect(await findLongOpenShifts(db, NOW)).toHaveLength(0)
    })

    it("jornada cerrada de 11 h (IN+OUT) → no aplica", async () => {
        const { db } = makeDb({
            businesses: [ACTIVE_BIZ],
            clockEvents: [
                clockIn("e1", "u1", hoursAgo(15)),
                clockOut("e2", "u1", hoursAgo(4)),
            ],
        })
        expect(await findLongOpenShifts(db, NOW)).toHaveLength(0)
    })

    it("usuario no APPROVED nunca genera candidato", async () => {
        const { db } = makeDb({
            businesses: [ACTIVE_BIZ],
            clockEvents: [clockIn("e1", "u1", hoursAgo(11), { status: "PENDING" })],
        })
        expect(await findLongOpenShifts(db, NOW)).toHaveLength(0)
    })

    it("solo negocios activos: se consulta con isActive:true y una fila inactiva se descarta", async () => {
        const { db, mocks } = makeDb({
            businesses: [{ id: "biz-off", name: "Suspendido", isActive: false }],
        })
        const shifts = await findLongOpenShifts(db, NOW)
        expect(shifts).toHaveLength(0)
        expect(mocks.businessFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true } }))
        // El negocio inactivo ni siquiera dispara la consulta de checadas.
        expect(mocks.clockEventFindMany).not.toHaveBeenCalled()
    })

    it("un fallo leyendo un negocio no detiene a los demás", async () => {
        const { db, mocks } = makeDb({
            businesses: [
                { id: "biz-roto", name: "Roto", isActive: true },
                ACTIVE_BIZ,
            ],
            clockEvents: [clockIn("e1", "u1", hoursAgo(11))],
        })
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        mocks.clockEventFindMany
            .mockRejectedValueOnce(new Error("db down"))
            .mockResolvedValueOnce([
                clockIn("e1", "u1", hoursAgo(11)),
            ])
        const shifts = await findLongOpenShifts(db, NOW)
        expect(shifts).toHaveLength(1)
        expect(shifts[0].businessId).toBe("biz-1")
        expect(warn).toHaveBeenCalled()
        warn.mockRestore()
    })
})

describe("sendLongShiftAlerts", () => {
    beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}))

    it("sin Notification previa → envía el DM y crea la fila de dedup", async () => {
        const { db, mocks } = makeDb()
        const bot = makeBot()
        const shift = makeShift()
        const r = await sendLongShiftAlerts(bot as any, db, [shift], NOW)
        expect(r).toMatchObject({ sent: 1, deduped: 0, noTelegram: 0, failed: 0 })
        expect(bot.telegram.sendMessage).toHaveBeenCalledTimes(1)
        expect(mocks.notificationCreate).toHaveBeenCalledTimes(1)
        const createArg = mocks.notificationCreate.mock.calls[0][0] as { data: Record<string, any> }
        expect(createArg.data).toMatchObject({
            businessId: "biz-1",
            type: LONG_SHIFT_NOTIFICATION_TYPE,
            audience: "STAFF",
            title: "Turno prolongado",
        })
        // El usuario viaja en data.userId: Notification no tiene columna userId.
        expect((createArg.data.data as Record<string, unknown>).userId).toBe("u1")
    })

    it("con Notification dentro de la jornada → no reenvía ni duplica dedup", async () => {
        const { db, mocks } = makeDb({ notification: { id: "n-old" } })
        const bot = makeBot()
        const shift = makeShift()
        const r = await sendLongShiftAlerts(bot as any, db, [shift], NOW)
        expect(r).toMatchObject({ sent: 0, deduped: 1, failed: 0 })
        expect(bot.telegram.sendMessage).not.toHaveBeenCalled()
        expect(mocks.notificationCreate).not.toHaveBeenCalled()
        // La deduplicación filtra por data.userId y createdAt dentro de ESTA jornada.
        const where = (mocks.notificationFindFirst.mock.calls[0]?.[0] as { where: Record<string, any> }).where
        expect(where.type).toBe(LONG_SHIFT_NOTIFICATION_TYPE)
        expect(where.businessId).toBe("biz-1")
        expect(where.data).toEqual({ path: ["userId"], equals: "u1" })
        expect((where.createdAt as { gte: Date }).gte).toEqual(shift.since)
    })

    it("usuario sin telegramId → no intenta envío ni crea Notification", async () => {
        const { db, mocks } = makeDb()
        const bot = makeBot()
        const r = await sendLongShiftAlerts(bot as any, db, [makeShift({ telegramId: null })], NOW)
        expect(r).toMatchObject({ sent: 0, noTelegram: 1, failed: 0 })
        expect(bot.telegram.sendMessage).not.toHaveBeenCalled()
        expect(mocks.notificationFindFirst).not.toHaveBeenCalled()
        expect(mocks.notificationCreate).not.toHaveBeenCalled()
    })

    it("sendMessage rechaza → sin dedup (reintenta la próxima hora) y los demás siguen", async () => {
        const { db, mocks } = makeDb()
        const bot = makeBot()
        bot.telegram.sendMessage
            .mockRejectedValueOnce(new Error("chat blocked"))
            .mockResolvedValueOnce({})
        const r = await sendLongShiftAlerts(bot as any, db, [
            makeShift({ userId: "u1", telegramId: "tg-1" }),
            makeShift({ userId: "u2", name: "Beto", telegramId: "tg-2" }),
        ], NOW)
        expect(r).toMatchObject({ sent: 1, failed: 1 })
        expect(bot.telegram.sendMessage).toHaveBeenCalledTimes(2)
        // Solo se creó dedup del envío exitoso.
        expect(mocks.notificationCreate).toHaveBeenCalledTimes(1)
        const createdFor = (mocks.notificationCreate.mock.calls[0][0] as any).data.data.userId
        expect(createdFor).toBe("u2")
    })

    it("el cuerpo del mensaje incluye el nombre y la hora de entrada formateada", async () => {
        const { db } = makeDb()
        const bot = makeBot()
        await sendLongShiftAlerts(bot as any, db, [makeShift()], NOW)
        const [chatId, text, opts] = bot.telegram.sendMessage.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
        expect(chatId).toBe("tg-1")
        expect(opts.parse_mode).toBe("HTML")
        expect(text).toContain("María")
        expect(text).toContain("09:15") // IN hace 11 h = 09:15 MX
        expect(text).toContain("turno abierto")
    })

    it("escapa HTML en el nombre del empleado", async () => {
        const { db } = makeDb()
        const bot = makeBot()
        await sendLongShiftAlerts(bot as any, db, [makeShift({ name: "A&B <Taller>" })], NOW)
        const text = (bot.telegram.sendMessage.mock.calls[0] as unknown as [string, string])[1]
        expect(text).toContain("A&amp;B &lt;Taller&gt;")
        expect(text).not.toContain("<Taller>")
    })
})

describe("formatShiftStart / formatLongShiftMessage", () => {
    it("IN del mismo día-negocio → solo HH:MM", () => {
        expect(formatShiftStart(hoursAgo(11), NOW)).toBe("09:15")
    })

    it("IN del día-negocio anterior → antepone dd/MM", () => {
        // 06:00 MX: un IN hace 11 h cayó a las 19:00 del día anterior.
        const early = new Date("2025-02-06T06:00:00-06:00")
        expect(formatShiftStart(hoursAgo(11, early), early)).toBe("05/02 19:00")
    })

    it("el mensaje menciona horas, hora de entrada y el Checador", () => {
        const msg = formatLongShiftMessage(makeShift(), NOW)
        expect(msg).toContain("más de 11 h")
        expect(msg).toContain("desde las 09:15")
        expect(msg).toContain("Checador")
    })
})

describe("runLongShiftAlerts", () => {
    beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}))

    it("negocio inactivo → no se envía nada", async () => {
        const { db } = makeDb({ businesses: [{ id: "biz-off", name: "Off", isActive: false }] })
        const bot = makeBot()
        const r = await runLongShiftAlerts(bot as any, db, false, NOW)
        expect(r.sent).toBe(0)
        expect(bot.telegram.sendMessage).not.toHaveBeenCalled()
    })

    it("barrido completo: jornada larga sin dedup → DM al empleado", async () => {
        const { db, mocks } = makeDb({
            businesses: [ACTIVE_BIZ],
            clockEvents: [clockIn("e1", "u1", hoursAgo(11))],
        })
        const bot = makeBot()
        const r = await runLongShiftAlerts(bot as any, db, false, NOW)
        expect(r.sent).toBe(1)
        expect(bot.telegram.sendMessage).toHaveBeenCalledWith("tg-1", expect.stringContaining("María"), expect.objectContaining({ parse_mode: "HTML" }))
        expect(mocks.notificationCreate).toHaveBeenCalledTimes(1)
    })
})

describe("registerLongShiftAlerts", () => {
    beforeEach(() => {
        scheduleMock.mockClear()
        vi.spyOn(console, "log").mockImplementation(() => {})
        vi.spyOn(console, "warn").mockImplementation(() => {})
    })

    it("programa el barrido a los :15 de cada hora, sin timezone (umbral por duración)", () => {
        const { db } = makeDb({})
        const bot = makeBot()
        registerLongShiftAlerts({ bot, prisma: db, isDev: false } as unknown as BotContext)
        expect(scheduleMock).toHaveBeenCalledWith("15 * * * *", expect.any(Function))
        // A diferencia del resumen diario NO lleva options.timezone.
        expect(scheduleMock.mock.calls[0]?.[2]).toBeUndefined()
    })

    it("el tick ejecuta el barrido y envía el ping", async () => {
        // El tick corre con new Date() real: el IN se siembra relativo a ahora.
        const { db } = makeDb({
            businesses: [ACTIVE_BIZ],
            clockEvents: [clockIn("e1", "u1", new Date(Date.now() - 11 * 3_600_000))],
        })
        const bot = makeBot()
        registerLongShiftAlerts({ bot, prisma: db, isDev: false } as unknown as BotContext)
        const tick = scheduleMock.mock.calls[0]?.[1] as unknown as () => Promise<void>
        await tick()
        expect(bot.telegram.sendMessage).toHaveBeenCalledTimes(1)
        const [chatId, text] = bot.telegram.sendMessage.mock.calls[0] as unknown as [string, string]
        expect(chatId).toBe("tg-1")
        expect(text).toContain("María")
        expect(text).toContain("turno abierto")
    })
})
