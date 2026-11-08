import { beforeEach, describe, expect, it, vi } from "vitest"
import type { BotContext } from "@/bot/lib/types"
import { clipMessage, TG_MESSAGE_MAX } from "@/bot/lib/format"

// Reliability pass: los handlers del bot no deben quedar mudos ni escribir en
// otro tenant cuando la BD falla a mitad de una acción.
const mocks = vi.hoisted(() => ({
  notifyAdmins: vi.fn(async () => {}),
  isAdmin: vi.fn(async () => true),
  requireAdmin: vi.fn(async () => true),
  requirePrisma: vi.fn(async () => true),
  getBotAccount: vi.fn(),
  createReservations: vi.fn(),
  sell: vi.fn(),
  getBusinessSetting: vi.fn(async () => null),
  setBusinessSetting: vi.fn(async () => {}),
  getDefaultBusinessId: vi.fn(async () => "biz-default"),
}))
vi.mock("@/bot/lib/notify", () => ({ notifyAdmins: mocks.notifyAdmins, isAdmin: mocks.isAdmin }))
vi.mock("@/bot/lib/guards", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/bot/lib/guards")>()
  return {
    ...original,
    requireAdmin: mocks.requireAdmin,
    requirePrisma: mocks.requirePrisma,
    getBotAccount: mocks.getBotAccount,
  }
})
vi.mock("@/lib/domain/reservations", () => ({ createReservations: mocks.createReservations }))
vi.mock("@/lib/domain/sales", () => ({ sell: mocks.sell }))
vi.mock("@/lib/settings", () => ({
  getBusinessSetting: mocks.getBusinessSetting,
  setBusinessSetting: mocks.setBusinessSetting,
  getDefaultBusinessId: mocks.getDefaultBusinessId,
  DEFAULT_SETTINGS: { pendingVerificationHours: 48 },
  DEFAULT_BUSINESS_ID: "biz-default",
}))

import { registerCatalog } from "@/bot/commands/catalog"
import { registerCart } from "@/bot/commands/cart"
import { registerSettings } from "@/bot/commands/settings"

type Handler = (ctx: any, next?: () => Promise<void>) => Promise<unknown>
function makeBot() {
  const actions: { trigger: string | RegExp | (string | RegExp)[]; callback: Handler }[] = []
  const commands = new Map<string, Handler>()
  const bot = {
    command: (name: string, callback: Handler) => commands.set(name, callback),
    action: (trigger: string | RegExp | (string | RegExp)[], callback: Handler) => actions.push({ trigger, callback }),
    on: vi.fn(),
    hears: vi.fn(),
    telegram: { sendMessage: vi.fn(async () => ({})), getFile: vi.fn() },
  }
  // Telegraf normaliza triggers: strings/arrays generan un RegExpExec con el
  // valor en match[0] — los handlers usan ctx.match[0] o ctx.match[1].
  const action = (data: string) => {
    const found = actions.find(({ trigger }) => {
      const list = Array.isArray(trigger) ? trigger : [trigger]
      return list.some(t => t instanceof RegExp ? (t.lastIndex = 0, t.test(data)) : t === data)
    })
    if (!found) throw new Error(`No action registered for ${data}`)
    const list = Array.isArray(found.trigger) ? found.trigger : [found.trigger]
    const regex = list.find(t => t instanceof RegExp) as RegExp | undefined
    const match = regex && regex.test(data) ? regex.exec(data)! : ([data] as unknown as RegExpExecArray)
    return { callback: found.callback, match }
  }
  const command = (name: string) => {
    const found = commands.get(name)
    if (!found) throw new Error(`No command registered for /${name}`)
    return found
  }
  return { bot, action, command }
}
const makeSessions = () => ({ registration: {}, adminProduct: {}, reservation: {}, deleteProduct: {}, sale: {}, cart: {}, qr: {}, settings: {}, orden: {} } as any)
const actionCtx = (id: number, match: RegExpExecArray | null) => ({
  from: { id }, chat: { type: "private" }, match, update: { update_id: 1 }, callbackQuery: { message: { message_id: 1 } },
  reply: vi.fn(async () => ({})), answerCbQuery: vi.fn(async () => ({})), editMessageText: vi.fn(async () => ({})), replyWithPhoto: vi.fn(async () => ({})), deleteMessage: vi.fn(async () => ({})), telegram: { sendMessage: vi.fn(async () => ({})) },
})
const textCtx = (id: number, text: string) => ({
  from: { id }, chat: { type: "private" }, message: { text },
  reply: vi.fn(async () => ({})), answerCbQuery: vi.fn(async () => ({})), editMessageText: vi.fn(async () => ({})),
})
const catalogCtx = (bot: any, prisma: any, sessions: any) =>
  registerCatalog({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)

describe("clipMessage keeps every reply under the Telegram 4096 limit", () => {
  it("returns short text untouched", () => {
    expect(clipMessage("hola")).toBe("hola")
  })
  it("truncates overlong text with an ellipsis at the limit", () => {
    const clipped = clipMessage("x".repeat(TG_MESSAGE_MAX + 500))
    expect(clipped.length).toBe(TG_MESSAGE_MAX)
    expect(clipped.endsWith("…")).toBe(true)
  })
})

describe("catalog actions do not fail silently when the DB throws", () => {
  beforeEach(() => vi.clearAllMocks())

  it("reserve_ replies an error and opens no session when the user lookup fails", async () => {
    const { bot, action } = makeBot()
    const prisma = { user: { findUnique: vi.fn(async () => { throw new Error("db down") }) }, product: { findUnique: vi.fn() }, category: { findMany: vi.fn(async () => []) } }
    const sessions = makeSessions()
    catalogCtx(bot, prisma, sessions)
    const { callback, match } = action("reserve_p1")
    const ctx = actionCtx(555, match)
    await callback(ctx)
    expect(sessions.reservation["555"]).toBeUndefined()
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("No se pudo iniciar la reserva"))
  })

  it("pay_transfer keeps the session at PAYMENT_METHOD when settings lookup fails", async () => {
    const { bot, action } = makeBot()
    const prisma = { user: { findUnique: vi.fn(async () => { throw new Error("db down") }) }, product: { findUnique: vi.fn() }, category: { findMany: vi.fn(async () => []) } }
    const sessions = makeSessions()
    sessions.reservation["555"] = { productId: "p1", productName: "Pantalla", price: 100, maxStock: 5, step: "PAYMENT_METHOD", quantity: 2 }
    catalogCtx(bot, prisma, sessions)
    const { callback } = action("pay_transfer")
    const ctx = actionCtx(555, null)
    await callback(ctx)
    expect(sessions.reservation["555"].step).toBe("PAYMENT_METHOD")
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("datos de pago"))
  })
})

describe("addtocart_ does not fail silently when the account lookup throws", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isAdmin.mockResolvedValue(true)
  })

  it("answers the callback with an error and leaves no cart behind", async () => {
    const { bot, action } = makeBot()
    mocks.getBotAccount.mockRejectedValue(new Error("db down"))
    const prisma = { product: { findUnique: vi.fn() } }
    const sessions = makeSessions()
    registerCart({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)
    const { callback, match } = action("addtocart_p1")
    const ctx = actionCtx(555, match)
    await callback(ctx)
    expect(ctx.answerCbQuery).toHaveBeenCalledWith(expect.stringContaining("Error"))
    expect(sessions.cart["555"]).toBeUndefined()
  })
})

describe("/ajustes never falls back to the default business", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdmin.mockResolvedValue(true)
  })

  it("bails when the actor row is missing instead of writing another tenant's settings", async () => {
    const { bot, action } = makeBot()
    const prisma = { user: { findUnique: vi.fn(async () => null) }, settings: { findFirst: vi.fn(async () => null) } }
    const sessions = makeSessions()
    registerSettings({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)
    const { callback, match } = action("set_hours")
    const ctx = actionCtx(555, match)
    await callback(ctx)
    // Antes: sessions.settings["555"] quedaba con businessId = getDefaultBusinessId().
    expect(sessions.settings["555"]).toBeUndefined()
    expect(mocks.getDefaultBusinessId).not.toHaveBeenCalled()
    expect(mocks.setBusinessSetting).not.toHaveBeenCalled()
  })

  it("scopes the settings session to the actor's own business", async () => {
    const { bot, action } = makeBot()
    const prisma = { user: { findUnique: vi.fn(async () => ({ businessId: "biz-own" })) }, settings: { findFirst: vi.fn(async () => null) } }
    const sessions = makeSessions()
    registerSettings({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)
    const { callback, match } = action("set_bank")
    const ctx = actionCtx(555, match)
    await callback(ctx)
    expect(sessions.settings["555"].businessId).toBe("biz-own")
    expect(sessions.settings["555"].key).toBe("bank_transfer_info")
  })

  it("/ajustes also bails when the actor row is missing", async () => {
    const { bot, command } = makeBot()
    const prisma = { user: { findUnique: vi.fn(async () => null) }, settings: { findFirst: vi.fn(async () => null) } }
    const sessions = makeSessions()
    registerSettings({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)
    const ctx = textCtx(555, "/ajustes")
    await command("ajustes")(ctx)
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Cuenta no disponible"))
    expect(mocks.getDefaultBusinessId).not.toHaveBeenCalled()
  })
})
