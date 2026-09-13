import { beforeEach, describe, expect, it, vi } from "vitest"
import type { BotContext } from "@/bot/lib/types"

const mocks = vi.hoisted(() => ({
  notifyAdmins: vi.fn(),
  isAdmin: vi.fn(),
  requireAdmin: vi.fn(),
  requirePrisma: vi.fn(),
  createReservations: vi.fn(),
}))
vi.mock("@/bot/lib/notify", () => ({ notifyAdmins: mocks.notifyAdmins, isAdmin: mocks.isAdmin }))
vi.mock("@/bot/lib/guards", () => ({ requireAdmin: mocks.requireAdmin, requirePrisma: mocks.requirePrisma }))
vi.mock("@/lib/domain/reservations", () => ({ createReservations: mocks.createReservations, expireReservations: vi.fn() }))
vi.mock("@/lib/settings", () => ({
  getBusinessSetting: vi.fn(async () => null),
  getBusinessSettingsMap: vi.fn(async () => new Map()),
  setBusinessSetting: vi.fn(async () => {}),
  getDefaultBusinessId: vi.fn(async () => "biz-test"),
  DEFAULT_BUSINESS_ID: "biz-default",
}))

import { registerUsers } from "@/bot/commands/users"
import { registerProducts } from "@/bot/commands/products"
import { registerCatalog } from "@/bot/commands/catalog"
import { registerSales } from "@/bot/commands/sales"

type Handler = (ctx: any, next?: () => Promise<void>) => Promise<unknown>
function makeBot() {
  const actions: { trigger: string | RegExp; callback: Handler }[] = []
  const listeners: Handler[] = []
  const hears: { trigger: RegExp; callback: Handler }[] = []
  const bot = {
    command: vi.fn(),
    hears: (trigger: RegExp, callback: Handler) => hears.push({ trigger, callback }),
    action: (trigger: string | RegExp, callback: Handler) => actions.push({ trigger, callback }),
    on: (_trigger: unknown, callback: Handler) => listeners.push(callback),
    telegram: { sendMessage: vi.fn(async () => ({})), getFile: vi.fn() },
  }
  const action = (data: string) => {
    const found = actions.find(({ trigger }) => trigger instanceof RegExp ? (trigger.lastIndex = 0, trigger.test(data)) : trigger === data)
    if (!found) throw new Error(`No action registered for ${data}`)
    return { callback: found.callback, match: found.trigger instanceof RegExp ? found.trigger.exec(data)! : null }
  }
  // Reproduce the telegraf chain: matching hears handlers may defer via next() to later text middleware.
  const dispatchText = async (ctx: any) => {
    const matching = hears.filter(({ trigger }) => (trigger.lastIndex = 0, trigger.test(ctx.message.text)))
    const runListeners = async () => { for (const listener of listeners) await listener(ctx, async () => {}) }
    if (matching.length === 0) return runListeners()
    let index = 0
    const next = async (): Promise<void> => { if (index < matching.length) await matching[index++].callback(ctx, next); else await runListeners() }
    await next()
  }
  return { bot, action, listeners, dispatchText }
}
function makePrisma() {
  return {
    user: {
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: any) => ({ id: "created-user", ...data })),
      update: vi.fn(async ({ data }: any) => ({ id: "updated-user", ...data })),
    },
    product: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    category: { findMany: vi.fn(async () => []) },
    systemSettings: { findUnique: vi.fn(async () => null) },
    $queryRaw: vi.fn(async () => []),
  }
}
const makeSessions = () => ({ registration: {}, adminProduct: {}, reservation: {}, deleteProduct: {}, sale: {}, cart: {}, qr: {}, settings: {} } as any)
const textCtx = (id: number, text: string) => ({
  from: { id }, chat: { type: "private" }, message: { text },
  reply: vi.fn(async () => ({})), sendChatAction: vi.fn(async () => ({})), answerCbQuery: vi.fn(async () => ({})), editMessageText: vi.fn(async () => ({})), replyWithPhoto: vi.fn(async () => ({})),
})
const actionCtx = (id: number, match: RegExpExecArray | null) => ({
  from: { id }, chat: { type: "private" }, match,
  reply: vi.fn(async () => ({})), answerCbQuery: vi.fn(async () => ({})), editMessageText: vi.fn(async () => ({})), replyWithPhoto: vi.fn(async () => ({})), deleteMessage: vi.fn(async () => ({})), telegram: { sendMessage: vi.fn() },
})
const goalSession = (customerType = "STORE") => ({ step: "GOAL", data: { name: "Ana Cliente", phone: "525512345678", customerType } })
const createdShape = (call: any) => {
  const data = call.data ?? call
  return { status: data.status, role: data.role, customerType: data.customerType, requestedCustomerType: data.requestedCustomerType }
}

describe("Telegram registration has a single pending-approval path (SEC-04)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("typing the goal creates the same PENDING account as the inline button", async () => {
    // Text entry (sales.ts number router -> products.ts main handler) and button entry (users.ts reg_goal_)
    // must produce identical accounts: exactly one PENDING user, requested type kept for admin review.
    for (const entry of ["text", "button"] as const) {
      const { bot, action, dispatchText } = makeBot()
      const prisma = makePrisma()
      const sessions = makeSessions()
      sessions.registration["555"] = goalSession()
      registerUsers({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)
      registerSales({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)
      registerProducts({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext, vi.fn(async () => {}))
      if (entry === "text") {
        await dispatchText(textCtx(555, "5000"))
      } else {
        const { callback, match } = action("reg_goal_5000")
        await callback(actionCtx(555, match))
      }
      expect(prisma.user.create).toHaveBeenCalledTimes(1)
      expect(createdShape(prisma.user.create.mock.calls[0][0])).toEqual({
        status: "PENDING", role: "CUSTOMER", customerType: "NORMAL", requestedCustomerType: "STORE",
      })
      expect(prisma.user.create.mock.calls[0][0].data.monthlyPurchaseGoal).toBe(5000)
      expect(sessions.registration["555"]).toBeUndefined()
    }
  })

  it("a repeated goal message cannot create a second account", async () => {
    const { bot, dispatchText } = makeBot()
    const prisma = makePrisma()
    const sessions = makeSessions()
    sessions.registration["555"] = goalSession()
    registerSales({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)
    registerProducts({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext, vi.fn(async () => {}))
    await dispatchText(textCtx(555, "5000"))
    await dispatchText(textCtx(555, "5000"))
    expect(prisma.user.create).toHaveBeenCalledTimes(1)
  })

  it("a stale goal callback after the wizard closed creates nothing", async () => {
    const { bot, action } = makeBot()
    const prisma = makePrisma()
    const sessions = makeSessions()
    registerUsers({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)
    const { callback, match } = action("reg_goal_5000")
    const ctx = actionCtx(555, match)
    await callback(ctx)
    expect(prisma.user.create).not.toHaveBeenCalled()
    expect(ctx.answerCbQuery).toHaveBeenCalledWith(expect.stringContaining("Sesión expirada"))
  })

  it("does not create a duplicate when the telegram account already exists", async () => {
    const { bot, action } = makeBot()
    const prisma = makePrisma()
    prisma.user.findUnique.mockResolvedValue({ id: "existing", status: "PENDING" } as any)
    const sessions = makeSessions()
    sessions.registration["555"] = goalSession()
    registerUsers({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)
    const { callback, match } = action("reg_goal_5000")
    const ctx = actionCtx(555, match)
    await callback(ctx)
    expect(prisma.user.create).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("pendiente"))
    expect(mocks.notifyAdmins).not.toHaveBeenCalled()
  })

  it("non-GOAL wizard steps never create an account", async () => {
    const { bot, listeners } = makeBot()
    const prisma = makePrisma()
    const sessions = makeSessions()
    sessions.registration["555"] = { step: "PHONE", data: { name: "Ana" } }
    registerProducts({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext, vi.fn(async () => {}))
    for (const listener of listeners) await listener(textCtx(555, "5512345678"), async () => {})
    expect(prisma.user.create).not.toHaveBeenCalled()
    expect(sessions.registration["555"].step).toBe("GOAL")
  })
})

describe("Telegram reservation requires approval revalidated at confirmation (SEC-04)", () => {
  beforeEach(() => vi.clearAllMocks())
  const reservationSession = () => ({ productId: "p1", productName: "Pantalla", price: 100, maxStock: 5, step: "PAYMENT_METHOD", quantity: 2 })

  it("rejects a payment callback when the account was rejected mid-flow", async () => {
    const { bot, action } = makeBot()
    const prisma = makePrisma()
    prisma.user.findUnique.mockResolvedValue({ id: "u1", role: "CUSTOMER", status: "REJECTED" } as any)
    const sessions = makeSessions()
    sessions.reservation["555"] = reservationSession()
    registerCatalog({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)
    const { callback } = action("pay_store")
    const ctx = actionCtx(555, null)
    await callback(ctx)
    expect(mocks.createReservations).not.toHaveBeenCalled()
    expect(sessions.reservation["555"]).toBeUndefined()
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("aprobada"))
  })

  it("rejects a reservation started before the account was demoted to PENDING", async () => {
    const { bot, action } = makeBot()
    const prisma = makePrisma()
    prisma.user.findUnique.mockResolvedValue({ id: "u1", role: "CUSTOMER", status: "PENDING" } as any)
    const sessions = makeSessions()
    sessions.reservation["555"] = reservationSession()
    registerCatalog({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)
    const { callback } = action("pay_credit")
    const ctx = actionCtx(555, null)
    await callback(ctx)
    expect(mocks.createReservations).not.toHaveBeenCalled()
  })

  it("a pending or non-approved admin cannot open the reservation flow", async () => {
    for (const user of [{ id: "u1", role: "CUSTOMER", status: "PENDING" }, { id: "u2", role: "ADMIN", status: "PENDING" }]) {
      const { bot, action } = makeBot()
      const prisma = makePrisma()
      prisma.user.findUnique.mockResolvedValue(user as any)
      prisma.product.findUnique.mockResolvedValue({ id: "p1", name: "Pantalla", stock: 5, retailPrice: 100 } as any)
      const sessions = makeSessions()
      registerCatalog({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)
      const { callback, match } = action("reserve_p1")
      const ctx = actionCtx(555, match)
      await callback(ctx)
      expect(sessions.reservation["555"]).toBeUndefined()
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("pendiente"))
    }
  })

  it("an approved customer still completes the reservation", async () => {
    const { bot, action } = makeBot()
    const prisma = makePrisma()
    prisma.user.findUnique.mockResolvedValue({ id: "u1", role: "CUSTOMER", status: "APPROVED", businessId: "biz-test" } as any)
    mocks.createReservations.mockResolvedValue({ reservations: [{ id: "res-1", qrCode: "QR1", totalPrice: 200 }], total: 200 })
    const sessions = makeSessions()
    sessions.reservation["555"] = reservationSession()
    registerCatalog({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)
    const { callback } = action("pay_store")
    const ctx = actionCtx(555, null)
    await callback(ctx)
    expect(mocks.createReservations).toHaveBeenCalledWith(prisma, "u1", "biz-test", expect.objectContaining({ productId: "p1", quantity: 2, paymentMethod: "STORE" }))
    expect(sessions.reservation["555"]).toBeUndefined()
  })
})
