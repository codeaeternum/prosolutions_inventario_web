import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ===== Mocks compartidos =====

// recordAudit: la bitácora del bot usa la misma action USER_UPDATE que el
// PATCH web de /api/users/[id]; aquí solo se espía que se emite.
const recordAuditMock = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("@/lib/audit", () => ({ recordAudit: recordAuditMock }))

// El wizard de registro no se prueba aquí; se corta el import para no
// arrastrar lib/settings → cliente prisma de servidor.
vi.mock("@/bot/lib/registration", () => ({ submitRegistration: vi.fn(async () => {}) }))

// Dominio de inventario/reservas: frontera de operación real, queda doblado.
const moveInventoryMock = vi.hoisted(() => vi.fn(async () => ({ movements: [{ newStock: 60 }] })))
vi.mock("@/lib/domain/inventory", () => ({ moveInventory: moveInventoryMock }))
const resolveBranchMock = vi.hoisted(() => vi.fn(async () => ({ id: "br-1", name: "Matriz" })))
vi.mock("@/lib/domain/operations", () => ({ resolveBranch: resolveBranchMock }))
vi.mock("@/lib/domain/reservations", () => ({ changeReservation: vi.fn() }))

// Verificación deep-link: consumeVerificationCode/markVerified doblados;
// VerificationError conserva `reason` para el instanceof del handler.
const consumeVerificationCodeMock = vi.hoisted(() => vi.fn())
const markVerifiedMock = vi.hoisted(() => vi.fn(async () => ({ promotedOwner: false })))
vi.mock("@/lib/verification", () => {
    class VerificationError extends Error {
        reason: string
        constructor(reason: string) { super(reason); this.reason = reason }
    }
    return {
        consumeVerificationCode: consumeVerificationCodeMock,
        markVerified: markVerifiedMock,
        VerificationError,
    }
})
vi.mock("@/lib/rate-limit", () => ({ checkAndRecord: vi.fn(() => true) }))
vi.mock("@/lib/mailer", () => ({ sendWelcomeEmail: vi.fn(async () => {}) }))

// node-cron queda doblado para disparar los ticks a mano.
const scheduleMock = vi.hoisted(() =>
    vi.fn<(expr?: string, fn?: unknown, opts?: unknown) => { stop: () => void; destroy: () => void }>(
        () => ({ stop: vi.fn(), destroy: vi.fn() })))
vi.mock("node-cron", () => ({ schedule: scheduleMock }))

const notifyAdminsMock = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("@/bot/lib/notify", async (importOriginal) => {
    const original = await importOriginal<typeof import("@/bot/lib/notify")>()
    return { ...original, notifyAdmins: notifyAdminsMock }
})

// getPrisma (singleton del bot) lo usa requirePrisma/isAdmin: stub benigno —
// truthy para que requirePrisma pase, inocuo si isAdmin lo consultara.
vi.mock("@/bot/lib/prisma", () => ({
    getPrisma: () => ({ user: { findUnique: async () => null } }),
}))

// src/lib/prisma (cliente del proceso web) lo importa lib/telegram.
const webUserFindManyMock = vi.hoisted(() => vi.fn(async (): Promise<any[]> => []))
const webUserFindFirstMock = vi.hoisted(() => vi.fn(async () => null))
vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: { findMany: webUserFindManyMock, findFirst: webUserFindFirstMock },
    },
}))

import { visibilityLevelsFor, visibilityWhere } from "@/bot/lib/visibility"
import { registerUsers, findAdminCommandTarget } from "@/bot/commands/users"
import { registerReports } from "@/bot/commands/reports"
import { registerStart } from "@/bot/commands/start"
import { registerAlerts, runStockAlerts } from "@/bot/commands/alerts"
import { retryOnTelegramLimit, telegramRetryAfterMs } from "@/bot/lib/utils"
import { sendTelegramToUsers } from "@/lib/telegram"

// ===== Bot/ctx falsos (capture de handlers) =====

type Handler = (ctx: any) => Promise<unknown> | unknown

function makeBot() {
    const actions: { trigger: unknown; fn: Handler }[] = []
    const commands = new Map<string, Handler>()
    const startFns: Handler[] = []
    const bot = {
        telegram: { sendMessage: vi.fn(async () => ({})) },
        action(trigger: unknown, fn: Handler) { actions.push({ trigger, fn }); return bot },
        command(name: string, fn: Handler) { commands.set(name, fn); return bot },
        on() { return bot },
        hears() { return bot },
        start(fn: Handler) { startFns.push(fn); return bot },
    }
    const findAction = (re: RegExp | null, data: string) => {
        const hit = actions.find(({ trigger }) => {
            if (trigger instanceof RegExp) return (re !== null && re.source === trigger.source) || trigger.test(data)
            return trigger === data
        })
        return hit?.fn
    }
    return { bot, actions, commands, startFns, findAction }
}

const baseCtx = (fromId = "777") => ({
    from: { id: Number(fromId) },
    chat: { type: "private" },
    reply: vi.fn(async () => ({})),
    answerCbQuery: vi.fn(async () => ({})),
    editMessageText: vi.fn(async () => ({})),
})

const makeSessions = () => {
    const rec = () => ({}) as Record<string, any>
    return {
        registration: rec(), adminProduct: rec(), reservation: rec(), deleteProduct: rec(),
        sale: rec(), cart: rec(), qr: rec(), settings: rec(), orden: rec(), stockAdjust: rec(), linkVerify: rec(),
    }
}

const ADMIN = { id: "u-admin", businessId: "biz-1", role: "ADMIN", status: "APPROVED", name: "Admin Uno", business: { isActive: true } }

beforeEach(() => {
    vi.clearAllMocks()
    recordAuditMock.mockClear()
})

// ===== T1: matriz de visibilidad del catálogo =====

describe("T1 · matriz marketVisibility (idéntica a la web)", () => {
    it("anónimo / PENDING / REJECTED → solo PUBLIC", () => {
        expect(visibilityLevelsFor(null)).toEqual(["PUBLIC"])
        expect(visibilityLevelsFor(undefined)).toEqual(["PUBLIC"])
        expect(visibilityLevelsFor({ role: "CUSTOMER", status: "PENDING" })).toEqual(["PUBLIC"])
        expect(visibilityLevelsFor({ role: "CUSTOMER", status: "REJECTED" })).toEqual(["PUBLIC"])
        expect(visibilityWhere({ role: "CUSTOMER", status: "PENDING" })).toEqual({ marketVisibility: { in: ["PUBLIC"] } })
    })

    it("WORKSHOP o CUSTOMER STORE/TECHNICIAN aprobado → ALLIES + PUBLIC", () => {
        expect(visibilityLevelsFor({ role: "WORKSHOP", status: "APPROVED" })).toEqual(["ALLIES", "PUBLIC"])
        expect(visibilityLevelsFor({ role: "CUSTOMER", status: "APPROVED", customerType: "STORE" })).toEqual(["ALLIES", "PUBLIC"])
        expect(visibilityLevelsFor({ role: "CUSTOMER", status: "APPROVED", customerType: "TECHNICIAN" })).toEqual(["ALLIES", "PUBLIC"])
    })

    it("CUSTOMER NORMAL aprobado y staff APPROVED → sin restricción (null)", () => {
        expect(visibilityLevelsFor({ role: "CUSTOMER", status: "APPROVED", customerType: "NORMAL" })).toBeNull()
        expect(visibilityLevelsFor({ role: "ADMIN", status: "APPROVED" })).toBeNull()
        expect(visibilityLevelsFor({ role: "EMPLOYEE", status: "APPROVED" })).toBeNull()
        expect(visibilityWhere({ role: "ADMIN", status: "APPROVED" })).toEqual({})
    })

    it("staff sin aprobar NO ve HIDDEN ni ALLIES (estatus manda)", () => {
        expect(visibilityLevelsFor({ role: "ADMIN", status: "PENDING" })).toEqual(["PUBLIC"])
    })
})

// ===== T2: aprobar/rechazar con guarda de estatus =====

function makeUsersPrisma(target: any, actor: any = ADMIN) {
    return {
        user: {
            findUnique: vi.fn(async () => actor),
            findFirst: vi.fn(async () => target),
            update: vi.fn(async ({ data }: any) => ({ ...target, ...data })),
            findMany: vi.fn(async () => []),
            count: vi.fn(async () => 0),
        },
    } as any
}

function approveCtx(targetId: string, fromId = "777") {
    const ctx = baseCtx(fromId) as any
    ctx.match = [`approve_user_${targetId}`, targetId]
    return ctx
}

describe("T2 · approve_user_ / reject_user_", () => {
    const sessions = makeSessions()

    it("PENDING + requestedCustomerType → APPROVED con el tipo pedido y audit USER_UPDATE", async () => {
        const target = { id: "u-1", name: "Ana", phone: "5511111111", telegramId: "555", status: "PENDING", customerType: "NORMAL", requestedCustomerType: "STORE" }
        const prisma = makeUsersPrisma(target)
        const { bot, findAction } = makeBot()
        registerUsers({ bot: bot as any, prisma, sessions } as any)
        const fn = findAction(/^approve_user_/, `approve_user_${target.id}`)!
        await fn(approveCtx(target.id))
        expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "u-1" }, data: { status: "APPROVED", customerType: "STORE" } })
        expect(recordAuditMock).toHaveBeenCalledWith(prisma, expect.objectContaining({ action: "USER_UPDATE", entity: "user", entityId: "u-1", businessId: "biz-1", actorId: "u-admin" }))
        expect(bot.telegram.sendMessage).toHaveBeenCalled() // aviso al afectado
    })

    it("APPROVED ya procesado → no update, no audit, toast 'Ya fue procesado'", async () => {
        const target = { id: "u-2", name: "Luis", phone: "5522222222", telegramId: null, status: "APPROVED", customerType: "NORMAL", requestedCustomerType: "STORE" }
        const prisma = makeUsersPrisma(target)
        const { bot, findAction } = makeBot()
        registerUsers({ bot: bot as any, prisma, sessions } as any)
        const ctx = approveCtx(target.id)
        await findAction(/^approve_user_/, "approve_user_x")!(ctx)
        expect(ctx.answerCbQuery).toHaveBeenCalledWith("Ya fue procesado")
        expect(prisma.user.update).not.toHaveBeenCalled()
        expect(recordAuditMock).not.toHaveBeenCalled()
    })

    it("REJECTED re-aprobable pero NO pisa customerType con el pedido viejo", async () => {
        const target = { id: "u-3", name: "Mara", phone: "5533333333", telegramId: null, status: "REJECTED", customerType: "TECHNICIAN", requestedCustomerType: "NORMAL" }
        const prisma = makeUsersPrisma(target)
        const { bot, findAction } = makeBot()
        registerUsers({ bot: bot as any, prisma, sessions } as any)
        await findAction(/^approve_user_/, "approve_user_x")!(approveCtx(target.id))
        expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "u-3" }, data: { status: "APPROVED" } })
        expect(recordAuditMock).toHaveBeenCalledWith(prisma, expect.objectContaining({ action: "USER_UPDATE" }))
    })

    it("reject solo procesa PENDING; sobre APPROVED no toca nada", async () => {
        const target = { id: "u-4", name: "Otto", phone: "5544444444", telegramId: null, status: "APPROVED", customerType: "NORMAL", requestedCustomerType: null }
        const prisma = makeUsersPrisma(target)
        const { bot, findAction } = makeBot()
        registerUsers({ bot: bot as any, prisma, sessions } as any)
        const ctx = { ...approveCtx(target.id), match: [`reject_user_${target.id}`, target.id] }
        await findAction(/^reject_user_/, "reject_user_x")!(ctx)
        expect(ctx.answerCbQuery).toHaveBeenCalledWith("Ya fue procesado")
        expect(prisma.user.update).not.toHaveBeenCalled()
        expect(recordAuditMock).not.toHaveBeenCalled()
    })

    it("reject PENDING → REJECTED con audit USER_UPDATE", async () => {
        const target = { id: "u-5", name: "Paz", phone: "5555555555", telegramId: null, status: "PENDING", customerType: "NORMAL", requestedCustomerType: null }
        const prisma = makeUsersPrisma(target)
        const { bot, findAction } = makeBot()
        registerUsers({ bot: bot as any, prisma, sessions } as any)
        const ctx = { ...approveCtx(target.id), match: [`reject_user_${target.id}`, target.id] }
        await findAction(/^reject_user_/, "reject_user_x")!(ctx)
        expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "u-5" }, data: { status: "REJECTED" } })
        expect(recordAuditMock).toHaveBeenCalledWith(prisma, expect.objectContaining({ action: "USER_UPDATE", summary: expect.stringContaining("Rechaz") }))
    })

    it("actor no admin → sin mutación", async () => {
        const prisma = makeUsersPrisma({ id: "u-6", status: "PENDING" }, { ...ADMIN, role: "CUSTOMER" })
        const { bot, findAction } = makeBot()
        registerUsers({ bot: bot as any, prisma, sessions } as any)
        await findAction(/^approve_user_/, "approve_user_x")!(approveCtx("u-6"))
        expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it("objetivo de OTRO tenant → findFirst con businessId del actor", async () => {
        const prisma = makeUsersPrisma(null)
        const { bot, findAction } = makeBot()
        registerUsers({ bot: bot as any, prisma, sessions } as any)
        const ctx = approveCtx("u-otro-tenant")
        await findAction(/^approve_user_/, "approve_user_x")!(ctx)
        expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { id: "u-otro-tenant", businessId: "biz-1" } })
        expect(prisma.user.update).not.toHaveBeenCalled()
    })
})

// ===== T3: makeadmin/removeadmin exacto + candidatos =====

describe("T3 · resolución /makeadmin /removeadmin", () => {
    it("telegramId completo → match exacto (sin substring)", async () => {
        const prisma = { user: { findMany: vi.fn(async () => [{ id: "u-1", name: "Ana", phone: null, telegramId: "123456789", role: "CUSTOMER", status: "APPROVED" }]) } } as any
        const r = await findAdminCommandTarget(prisma, "biz-1", "123456789")
        expect(r.match?.id).toBe("u-1")
        expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { businessId: "biz-1", OR: [{ telegramId: "123456789" }, { phoneNormalized: "123456789" }] } }))
    })

    it("teléfono completo normaliza a phoneNormalized (últimos 10 dígitos)", async () => {
        const prisma = { user: { findMany: vi.fn(async () => [{ id: "u-9", name: "Juan", phone: "+52 55 1234 5678", telegramId: null, role: "CUSTOMER", status: "APPROVED" }]) } } as any
        const r = await findAdminCommandTarget(prisma, "biz-1", "+52 55 1234 5678")
        expect(r.match?.id).toBe("u-9")
        expect(prisma.user.findMany.mock.calls[0][0].where.OR).toContainEqual({ phoneNormalized: "5512345678" })
    })

    it("sin match exacto → candidatos por nombre/teléfono, nunca muta", async () => {
        const prisma = { user: { findMany: vi.fn(async () => [{ id: "u-7", name: "Pepe", phone: "5512345600", telegramId: null, role: "CUSTOMER", status: "APPROVED" }]) } } as any
        const r = await findAdminCommandTarget(prisma, "biz-1", "pepe")
        expect(r.match).toBeNull()
        expect(r.candidates.map((c) => c.id)).toEqual(["u-7"])
        // 'pepe' no tiene dígitos: ni siquiera corre la consulta exacta — solo
        // la de candidatos (una sola llamada, con contains).
        expect(prisma.user.findMany).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(prisma.user.findMany.mock.calls[0][0].where)).toContain("contains")
    })

    it("fragmento numérico corto tampoco promueve al primer contains", async () => {
        // "55" era el caso del bug: contains devolvía un match arbitrario.
        const prisma = {
            user: {
                findMany: vi.fn(async (q: any) =>
                    q.where.OR.every((c: any) => c.name || c.phoneNormalized?.contains || c.phone?.contains)
                        ? [{ id: "u-a", name: "A", phone: "5511", telegramId: null, role: "CUSTOMER", status: "APPROVED" }, { id: "u-b", name: "B", phone: "5522", telegramId: null, role: "CUSTOMER", status: "APPROVED" }]
                        : []),
            },
        } as any
        const r = await findAdminCommandTarget(prisma, "biz-1", "55")
        expect(r.match).toBeNull() // jamás devuelve match por fragmento
        expect(r.candidates).toHaveLength(2)
    })

    it("mkadm_ confirma rol dentro del tenant + audit + aviso al afectado", async () => {
        const target = { id: "u-8", name: "Luz", phone: "5500000001", telegramId: "5558", role: "CUSTOMER", status: "APPROVED" }
        const prisma = {
            user: {
                findUnique: vi.fn(async () => ADMIN),
                findFirst: vi.fn(async () => target),
                update: vi.fn(async ({ data }: any) => ({ ...target, ...data })),
                findMany: vi.fn(async () => []),
                count: vi.fn(async () => 0),
            },
        } as any
        const { bot, findAction } = makeBot()
        registerUsers({ bot: bot as any, prisma, sessions: makeSessions() } as any)
        const ctx = baseCtx() as any
        ctx.match = [`mkadm_${target.id}`, target.id]
        await findAction(/^mkadm_/, "mkadm_x")!(ctx)
        expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "u-8", businessId: "biz-1" } }))
        expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "u-8" }, data: { role: "ADMIN" } })
        expect(recordAuditMock).toHaveBeenCalledWith(prisma, expect.objectContaining({ action: "USER_UPDATE", entity: "user", entityId: "u-8" }))
        expect(bot.telegram.sendMessage).toHaveBeenCalledWith("5558", expect.stringContaining("Administrador"), expect.anything())
    })
})

// ===== T4: retry_after 429 + timeout =====

describe("T4 · retry_after / timeout", () => {
    it("telegramRetryAfterMs: lee retry_after y capea a 60 s", () => {
        expect(telegramRetryAfterMs({ response: { parameters: { retry_after: 3 } } })).toBe(3000)
        expect(telegramRetryAfterMs({ response: { parameters: { retry_after: 120 } } })).toBe(60_000)
        expect(telegramRetryAfterMs(new Error("boom"))).toBe(0)
    })

    it("retryOnTelegramLimit reintenta UNA vez tras 429", async () => {
        let calls = 0
        const fn = vi.fn(async () => {
            calls++
            if (calls === 1) throw { response: { parameters: { retry_after: 0.001 } } }
            return "ok"
        })
        await expect(retryOnTelegramLimit(fn)).resolves.toBe("ok")
        expect(fn).toHaveBeenCalledTimes(2)
    })

    it("retryOnTelegramLimit no reintenta errores que no son 429", async () => {
        const fn = vi.fn(async () => { throw new Error("otro") })
        await expect(retryOnTelegramLimit(fn)).rejects.toThrow("otro")
        expect(fn).toHaveBeenCalledTimes(1)
    })

    it("429 persistente → solo 2 llamadas (sin bucles)", async () => {
        const fn = vi.fn(async () => { throw { response: { parameters: { retry_after: 0.001 } } } })
        await expect(retryOnTelegramLimit(fn)).rejects.toBeTruthy()
        expect(fn).toHaveBeenCalledTimes(2)
    })

    it("sendTelegramToUsers: 429 con retry_after reintenta una vez y usa AbortSignal de 8 s", async () => {
        process.env.TELEGRAM_BOT_TOKEN = "tok-test"
        webUserFindManyMock.mockResolvedValue([{ telegramId: "111" }])
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ status: 429, ok: false, json: async () => ({ parameters: { retry_after: 0 } }) })
            .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ ok: true }) })
        vi.stubGlobal("fetch", fetchMock)
        try {
            const sent = await sendTelegramToUsers("biz-1", "hola")
            expect(sent).toBe(1)
            expect(fetchMock).toHaveBeenCalledTimes(2)
            const init = fetchMock.mock.calls[0][1] as RequestInit
            expect(init.signal).toBeInstanceOf(AbortSignal)
        } finally {
            vi.unstubAllGlobals()
            delete process.env.TELEGRAM_BOT_TOKEN
        }
    })

    it("sendTelegramToUsers: HTTP 500 no reintenta", async () => {
        process.env.TELEGRAM_BOT_TOKEN = "tok-test"
        webUserFindManyMock.mockResolvedValue([{ telegramId: "111" }])
        const fetchMock = vi.fn().mockResolvedValue({ status: 500, ok: false, json: async () => ({}) })
        vi.stubGlobal("fetch", fetchMock)
        try {
            const sent = await sendTelegramToUsers("biz-1", "hola")
            expect(sent).toBe(0)
            expect(fetchMock).toHaveBeenCalledTimes(1)
        } finally {
            vi.unstubAllGlobals()
            delete process.env.TELEGRAM_BOT_TOKEN
        }
    })
})

// ===== T5: overlap guard del cron de stock =====

describe("T5 · overlap guard", () => {
    it("un segundo tick mientras la corrida sigue viva se salta", async () => {
        let resolveFind: ((v: unknown) => void) | null = null
        const prisma = {
            product: { findMany: vi.fn(() => new Promise((res) => { resolveFind = res })) },
            systemSettings: {
                findMany: vi.fn(async () => []),
                deleteMany: vi.fn(async () => ({ count: 0 })),
                upsert: vi.fn(async () => ({})),
            },
        } as any
        const { bot } = makeBot()
        registerAlerts({ bot: bot as any, prisma, isDev: false } as any)
        const tick = scheduleMock.mock.calls.find((c) => c[0] === "0 * * * *")?.[1] as () => Promise<void>
        expect(tick).toBeTypeOf("function")

        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const p1 = tick() // queda corriendo: findMany no resuelve
        const p2 = tick() // debe saltarse
        await p2
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("se salta"))
        expect(prisma.product.findMany).toHaveBeenCalledTimes(1)
        resolveFind!([])
        await p1
        warn.mockRestore()
    })

    it("la consulta de stock filtra negocios activos", async () => {
        const prisma = {
            product: { findMany: vi.fn(async () => []) },
            systemSettings: {
                findMany: vi.fn(async () => []),
                deleteMany: vi.fn(async () => ({ count: 0 })),
                upsert: vi.fn(async () => ({})),
            },
        } as any
        await runStockAlerts(makeBot().bot as any, prisma, false)
        expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ business: { isActive: true } }),
        }))
    })
})

// ===== T6: /stock confirmación y deep-link verify =====

function makeStockPrisma(stockQty: number) {
    return {
        user: { findUnique: vi.fn(async () => ({ ...ADMIN, homeBranchId: "br-1" })) },
        product: { findUnique: vi.fn(async () => ({ id: "p-1", name: "Pantalla X", stock: stockQty })) },
        branchStock: { findUnique: vi.fn(async () => ({ quantity: stockQty })) },
    } as any
}

describe("T6 · /stock con confirmación", () => {
    it("cambio grande (|diff|>50) pide confirmación y NO aplica hasta el botón", async () => {
        const prisma = makeStockPrisma(10)
        const { bot, commands, findAction } = makeBot()
        const sessions = makeSessions()
        registerReports({ bot: bot as any, prisma, sessions } as any)
        const ctx = { ...baseCtx(), message: { text: "/stock p-1 200" } } as any
        await commands.get("stock")!(ctx)
        expect(moveInventoryMock).not.toHaveBeenCalled()
        expect(sessions.stockAdjust["777"]).toBeDefined()
        expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Ajuste grande"), expect.anything())

        const confirm = findAction(null, "stock_confirm")!
        const cbCtx = baseCtx() as any
        await confirm(cbCtx)
        expect(moveInventoryMock).toHaveBeenCalledTimes(1)
        expect(sessions.stockAdjust["777"]).toBeUndefined()
    })

    it("ajuste chico aplica directo sin sesión", async () => {
        const prisma = makeStockPrisma(100)
        const { bot, commands } = makeBot()
        const sessions = makeSessions()
        registerReports({ bot: bot as any, prisma, sessions } as any)
        const ctx = { ...baseCtx(), message: { text: "/stock p-1 105" } } as any
        await commands.get("stock")!(ctx)
        expect(moveInventoryMock).toHaveBeenCalledTimes(1)
        expect(sessions.stockAdjust["777"]).toBeUndefined()
    })

    it("stock_confirm con existencia movida aborta el ajuste", async () => {
        const prisma = makeStockPrisma(10)
        const { bot, commands, findAction } = makeBot()
        const sessions = makeSessions()
        registerReports({ bot: bot as any, prisma, sessions } as any)
        await commands.get("stock")!({ ...baseCtx(), message: { text: "/stock p-1 200" } } as any)
        // Entre el prompt y el clic la existencia cambió (venta de por medio).
        prisma.branchStock.findUnique.mockResolvedValue({ quantity: 33 })
        const cbCtx = baseCtx() as any
        await findAction(null, "stock_confirm")!(cbCtx)
        expect(moveInventoryMock).not.toHaveBeenCalled()
        expect(cbCtx.editMessageText).toHaveBeenCalledWith(expect.stringContaining("no se aplicó"))
    })
})

describe("T6 · deep-link verify_ pide confirmación antes de escribir telegramId", () => {
    const prisma = () => ({
        user: {
            findUnique: vi.fn(async ({ where }: any) => {
                if (where.id === "u-t") return { id: "u-t", name: "Ana", telegramId: null, business: { name: "Reficio" } }
                return null // holder de telegramId: nadie lo tiene
            }),
            update: vi.fn(async () => ({})),
        },
    })

    it("consume código, marca verificado y NO escribe telegramId hasta tglink_yes", async () => {
        consumeVerificationCodeMock.mockResolvedValue({ userId: "u-t", channel: "TELEGRAM" })
        const p = prisma()
        const linkSessions: Record<string, any> = {}
        const { bot, startFns, findAction } = makeBot()
        registerStart(bot as any, p as any, {}, linkSessions)

        const ctx = { ...baseCtx("777"), payload: "verify_123456" } as any
        await startFns[0](ctx)
        expect(consumeVerificationCodeMock).toHaveBeenCalledWith(p, { code: "123456", channel: "TELEGRAM" })
        expect(markVerifiedMock).toHaveBeenCalledWith(p, "u-t", "TELEGRAM")
        expect(p.user.update).not.toHaveBeenCalled()
        expect(linkSessions["777"]?.targetUserId).toBe("u-t")
        expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("¿Vincular esta cuenta de Telegram a"), expect.anything())

        await findAction(null, "tglink_yes")!(baseCtx() as any)
        expect(p.user.update).toHaveBeenCalledWith({ where: { id: "u-t" }, data: { telegramId: "777" } })
    })

    it("tglink_no limpia la sesión y no escribe nada", async () => {
        consumeVerificationCodeMock.mockResolvedValue({ userId: "u-t", channel: "TELEGRAM" })
        const p = prisma()
        const linkSessions: Record<string, any> = {}
        const { bot, startFns, findAction } = makeBot()
        registerStart(bot as any, p as any, {}, linkSessions)
        await startFns[0]({ ...baseCtx(), payload: "verify_123456" } as any)
        expect(linkSessions["777"]).toBeDefined()
        const ctx = baseCtx() as any
        await findAction(null, "tglink_no")!(ctx)
        expect(p.user.update).not.toHaveBeenCalled()
        expect(linkSessions["777"]).toBeUndefined()
    })
})

// ===== /desvincular: solo la propia cuenta =====

describe("T6 · /desvincular solo quita el telegramId propio", () => {
    it("unlink_confirm actúa sobre ctx.from.id, nunca un id del payload", async () => {
        const prisma = {
            user: {
                findUnique: vi.fn(async ({ where }: any) => where.telegramId === "777" ? { id: "u-me", name: "Yo" } : null),
                update: vi.fn(async () => ({})),
                count: vi.fn(async () => 3),
            },
        } as any
        const { bot, commands, findAction } = makeBot()
        registerUsers({ bot: bot as any, prisma, sessions: makeSessions() } as any)
        await commands.get("desvincular")!(baseCtx("777") as any)
        const ctx = baseCtx("777") as any
        await findAction(null, "unlink_confirm")!(ctx)
        expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "u-me" }, data: { telegramId: null } })
    })

    it("advierte cuando es el único Telegram del negocio", async () => {
        const prisma = {
            user: {
                findUnique: vi.fn(async () => ({ id: "u-me", name: "Yo", businessId: "biz-1" })),
                update: vi.fn(async () => ({})),
                count: vi.fn(async () => 1),
            },
        } as any
        const { bot, commands } = makeBot()
        registerUsers({ bot: bot as any, prisma, sessions: makeSessions() } as any)
        const ctx = baseCtx("777") as any
        await commands.get("desvincular")!(ctx)
        expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("único"), expect.anything())
    })
})

afterEach(() => {
    vi.restoreAllMocks()
})
