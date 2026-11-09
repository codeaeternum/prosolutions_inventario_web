import { beforeEach, describe, expect, it, vi } from "vitest"
import type { BotContext } from "@/bot/lib/types"

// El cron queda doblado: se verifica la expresión y se dispara el tick a mano.
const scheduleMock = vi.hoisted(() =>
    vi.fn<(expr?: string, fn?: unknown, opts?: unknown) => { stop: () => void; destroy: () => void }>(
        () => ({ stop: vi.fn(), destroy: vi.fn() })))
vi.mock("node-cron", () => ({ schedule: scheduleMock }))

// notifyAdmins (lib/notify) resuelve admins por su cuenta con el cliente
// global del bot; aquí solo importa que se llamó por negocio/mensaje.
const notifyAdminsMock = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("@/bot/lib/notify", () => ({ notifyAdmins: notifyAdminsMock }))

import {
    registerAlerts,
    resetStockAlertCacheForTests,
    runStockAlerts,
    STOCK_ALERT_KEY_PREFIX,
} from "@/bot/commands/alerts"

const NOW = new Date("2026-02-06T12:00:00Z")

const product = (id: string, over: Partial<{ name: string; stock: number; businessId: string }> = {}) => ({
    id,
    name: over.name ?? `Producto ${id}`,
    stock: over.stock ?? 0,
    businessId: over.businessId ?? "biz-1",
})

const alertRow = (productId: string, ts: number) => ({
    key: `${STOCK_ALERT_KEY_PREFIX}${productId}`,
    value: String(ts),
})

interface DbOverrides {
    out?: ReturnType<typeof product>[]
    alertRows?: { key: string; value: string }[]
}

function makeDb(o: DbOverrides = {}) {
    const mocks = {
        productFindMany: vi.fn<(q?: any) => Promise<any>>(async () => o.out ?? []),
        sysFindMany: vi.fn<(q?: any) => Promise<any>>(async () => o.alertRows ?? []),
        sysDeleteMany: vi.fn<(q?: any) => Promise<any>>(async () => ({ count: 0 })),
        sysUpsert: vi.fn<(q?: any) => Promise<any>>(async () => ({})),
    }
    const db = {
        product: { findMany: mocks.productFindMany },
        systemSettings: {
            findMany: mocks.sysFindMany,
            deleteMany: mocks.sysDeleteMany,
            upsert: mocks.sysUpsert,
        },
    }
    return { db: db as any, mocks }
}

const makeBot = () => ({ telegram: { sendMessage: vi.fn(async () => ({})) } })

beforeEach(() => {
    vi.clearAllMocks()
    // La fast-path en RAM es estado del módulo: sin reset un producto
    // alertado en un test contaminaría el dedup del siguiente.
    resetStockAlertCacheForTests()
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("runStockAlerts", () => {
    it("agotado sin marca persistida → avisa y persiste stock_alert_at_<productId>", async () => {
        const { db, mocks } = makeDb({ out: [product("p1"), product("p2")] })
        const r = await runStockAlerts(makeBot() as any, db, false, NOW)
        expect(r).toMatchObject({ outOfStock: 2, alerted: 2, deduped: 0 })
        expect(notifyAdminsMock).toHaveBeenCalledTimes(1)
        const [, businessId, msg] = notifyAdminsMock.mock.calls[0] as unknown as [unknown, string, string]
        expect(businessId).toBe("biz-1")
        expect(msg).toContain("2 producto(s) sin stock")
        // Una marca persistida por producto alertado.
        expect(mocks.sysUpsert).toHaveBeenCalledTimes(2)
        for (const call of mocks.sysUpsert.mock.calls) {
            const arg = call[0] as { where: { businessId_key: { businessId: string; key: string } }; create: { type: string; value: string } }
            expect(arg.where.businessId_key.businessId).toBe("biz-1")
            expect(arg.where.businessId_key.key).toMatch(new RegExp(`^${STOCK_ALERT_KEY_PREFIX}p`))
            expect(arg.create.value).toBe(String(NOW.getTime()))
        }
    })

    it("marca persistida hace <24 h → no re-alerta (el dedup sobrevive restarts)", async () => {
        const { db, mocks } = makeDb({
            out: [product("p1")],
            alertRows: [alertRow("p1", NOW.getTime() - 2 * 60 * 60 * 1000)],
        })
        const r = await runStockAlerts(makeBot() as any, db, false, NOW)
        expect(r).toMatchObject({ outOfStock: 1, alerted: 0, deduped: 1 })
        expect(notifyAdminsMock).not.toHaveBeenCalled()
        expect(mocks.sysUpsert).not.toHaveBeenCalled()
    })

    it("marca persistida hace >24 h → re-alerta, borra la llave vieja y escribe la nueva", async () => {
        const { db, mocks } = makeDb({
            out: [product("p1")],
            alertRows: [alertRow("p1", NOW.getTime() - 25 * 60 * 60 * 1000)],
        })
        const r = await runStockAlerts(makeBot() as any, db, false, NOW)
        expect(r).toMatchObject({ outOfStock: 1, alerted: 1, deduped: 0 })
        expect(notifyAdminsMock).toHaveBeenCalledTimes(1)
        const delArg = mocks.sysDeleteMany.mock.calls[0][0] as { where: { key: { in: string[] } } }
        expect(delArg.where.key.in).toEqual([`${STOCK_ALERT_KEY_PREFIX}p1`])
        expect(mocks.sysUpsert).toHaveBeenCalledTimes(1)
    })

    it("producto que volvió a tener stock → su llave persistida se borra (resetea cooldown)", async () => {
        const { db, mocks } = makeDb({
            out: [product("p1")],
            alertRows: [
                alertRow("p1", NOW.getTime() - 60 * 1000),
                // p-restocked ya no está agotado: su llave quedó obsoleta.
                alertRow("p-restocked", NOW.getTime() - 60 * 1000),
            ],
        })
        const r = await runStockAlerts(makeBot() as any, db, false, NOW)
        expect(r).toMatchObject({ outOfStock: 1, deduped: 1 })
        const delArg = mocks.sysDeleteMany.mock.calls[0][0] as { where: { key: { in: string[] } } }
        expect(delArg.where.key.in).toEqual([`${STOCK_ALERT_KEY_PREFIX}p-restocked`])
    })

    it("más de 25 agotados → el mensaje lista solo 25 y avisa el resto como conteo", async () => {
        const many = Array.from({ length: 30 }, (_, i) => product(`p${i}`))
        const { db } = makeDb({ out: many })
        await runStockAlerts(makeBot() as any, db, false, NOW)
        const [, , msg] = notifyAdminsMock.mock.calls[0] as unknown as [unknown, string, string]
        expect(msg).toContain("30 producto(s) sin stock")
        expect(msg).toContain("25. ❌")
        expect(msg).not.toContain("26. ❌")
        expect(msg).toContain("…y 5 más")
    })

    it("sin agotados → no avisa ni escribe", async () => {
        const { db, mocks } = makeDb()
        const r = await runStockAlerts(makeBot() as any, db, false, NOW)
        expect(r).toMatchObject({ outOfStock: 0, alerted: 0, deduped: 0 })
        expect(notifyAdminsMock).not.toHaveBeenCalled()
        expect(mocks.sysUpsert).not.toHaveBeenCalled()
    })

    it("agrupa por negocio: cada tenant recibe solo SUS agotados", async () => {
        const { db } = makeDb({
            out: [product("p1", { businessId: "biz-1" }), product("p2", { businessId: "biz-2" })],
        })
        await runStockAlerts(makeBot() as any, db, false, NOW)
        expect(notifyAdminsMock).toHaveBeenCalledTimes(2)
        const bizs = notifyAdminsMock.mock.calls.map(c => (c as unknown as [unknown, string])[1])
        expect(bizs.sort()).toEqual(["biz-1", "biz-2"])
    })
})

describe("registerAlerts", () => {
    it("programa el barrido a la hora en punto", () => {
        const { db } = makeDb()
        registerAlerts({ bot: makeBot(), prisma: db, isDev: false } as unknown as BotContext)
        expect(scheduleMock).toHaveBeenCalledWith("0 * * * *", expect.any(Function))
    })

    it("el tick ejecuta el barrido", async () => {
        const { db } = makeDb({ out: [product("p1")] })
        registerAlerts({ bot: makeBot(), prisma: db, isDev: false } as unknown as BotContext)
        const tick = scheduleMock.mock.calls[0]?.[1] as unknown as () => Promise<void>
        await tick()
        expect(notifyAdminsMock).toHaveBeenCalledTimes(1)
    })
})
