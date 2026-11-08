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
vi.mock("@/lib/domain/operations", () => ({
  actor: vi.fn(),
  transaction: vi.fn(async (p: any, fn: any) => fn(p)),
  BusinessError: class BusinessError extends Error {},
  resolveBranch: vi.fn(async () => ({ id: "br-1", name: "Sucursal" })),
}))
vi.mock("@/lib/domain/workshop", () => ({ createRepair: vi.fn() }))
vi.mock("@/lib/domain/delegation", () => ({ delegateRepairToPartner: vi.fn(), resolveRepairPartner: vi.fn() }))
vi.mock("@/lib/access", () => ({ hasModule: vi.fn(() => true), hasBranchAccess: vi.fn(() => true) }))
vi.mock("@/lib/device-profiles", () => ({ DEVICE_PROFILES: { Celular: {}, Tablet: {} } }))
vi.mock("@/lib/workshop-labels", () => ({ formatFolio: vi.fn(() => "R-0001"), parseFolioDigits: vi.fn(() => 4) }))
vi.mock("@/lib/settings", () => ({
  getBusinessSetting: mocks.getBusinessSetting,
  setBusinessSetting: mocks.setBusinessSetting,
  getDefaultBusinessId: mocks.getDefaultBusinessId,
  DEFAULT_SETTINGS: { pendingVerificationHours: 48 },
  DEFAULT_BUSINESS_ID: "biz-default",
}))

import { registerCatalog } from "@/bot/commands/catalog"
import { registerCart } from "@/bot/commands/cart"
import { registerSales } from "@/bot/commands/sales"
import { registerSettings } from "@/bot/commands/settings"
import { registerOrden } from "@/bot/commands/orden"
import { CART_MAX_ITEMS } from "@/bot/lib/types"

type Handler = (ctx: any, next?: () => Promise<void>) => Promise<unknown>
function makeBot() {
  const actions: { trigger: string | RegExp | (string | RegExp)[]; callback: Handler }[] = []
  const commands = new Map<string, Handler>()
  const hearsList: { trigger: RegExp; callback: Handler }[] = []
  const bot = {
    command: (name: string, callback: Handler) => commands.set(name, callback),
    action: (trigger: string | RegExp | (string | RegExp)[], callback: Handler) => actions.push({ trigger, callback }),
    on: vi.fn(),
    hears: (trigger: RegExp, callback: Handler) => hearsList.push({ trigger, callback }),
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
  const hears = (text: string) => {
    const found = hearsList.find(({ trigger }) => (trigger.lastIndex = 0, trigger.test(text)))
    if (!found) throw new Error(`No hears registered for "${text}"`)
    return found.callback
  }
  return { bot, action, command, hears }
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
    mocks.getBotAccount.mockResolvedValue(null)
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
    mocks.getBotAccount.mockResolvedValue({ id: "u1", businessId: "biz-own", role: "ADMIN", status: "APPROVED", name: "Admin" })
    const prisma = { user: { findUnique: vi.fn(async () => null) }, settings: { findFirst: vi.fn(async () => null) } }
    const sessions = makeSessions()
    registerSettings({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)
    const { callback, match } = action("set_bank")
    const ctx = actionCtx(555, match)
    await callback(ctx)
    expect(sessions.settings["555"].businessId).toBe("biz-own")
    expect(sessions.settings["555"].key).toBe("bank_transfer_info")
  })

  it("denies the settings action to a non-admin without leaving the spinner hanging", async () => {
    const { bot, action } = makeBot()
    mocks.getBotAccount.mockResolvedValue({ id: "u1", businessId: "biz-own", role: "CUSTOMER", status: "APPROVED", name: "Ana" })
    const prisma = { user: { findUnique: vi.fn(async () => null) }, settings: { findFirst: vi.fn(async () => null) } }
    const sessions = makeSessions()
    registerSettings({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)
    const { callback, match } = action("set_hours")
    const ctx = actionCtx(555, match)
    await callback(ctx)
    // Antes: requireAdmin respondía por reply y el callback quedaba girando.
    expect(ctx.answerCbQuery).toHaveBeenCalledWith(expect.stringContaining("administradores"))
    expect(sessions.settings["555"]).toBeUndefined()
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

const adminAccount = { id: "u1", businessId: "biz-own", role: "ADMIN", status: "APPROVED", name: "Admin", allowedModules: [], allowedBranchIds: [], homeBranchId: null }
const cartItem = (id: string) => ({ id, name: `Producto ${id}`, quantity: 1, price: 10, stock: 5 })
const fullCart = () => ({ items: Array.from({ length: CART_MAX_ITEMS }, (_, i) => cartItem(`p${i}`)) })

describe("cart cap: the wizard cannot grow the cart past CART_MAX_ITEMS", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getBotAccount.mockResolvedValue(adminAccount)
  })

  it("addtocart_ refuses a NEW item when the cart is full", async () => {
    const { bot, action } = makeBot()
    const product = { id: "pNew", name: "Nuevo", stock: 5, retailPrice: 10 }
    const prisma = { product: { findUnique: vi.fn(async () => product) } }
    const sessions = makeSessions()
    sessions.cart["555"] = fullCart()
    registerCart({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)
    const { callback, match } = action("addtocart_pNew")
    const ctx = actionCtx(555, match)
    await callback(ctx)
    expect(ctx.answerCbQuery).toHaveBeenCalledWith(expect.stringContaining("lleno"))
    expect(sessions.cart["555"].items).toHaveLength(CART_MAX_ITEMS)
    // Dedup medible: el gate+tenant salen del MISMO getBotAccount; isAdmin ya
    // no hace un findUnique aparte.
    expect(mocks.getBotAccount).toHaveBeenCalledTimes(1)
    expect(mocks.isAdmin).not.toHaveBeenCalled()
  })

  it("addtocart_ still increments quantity of an item already in a full cart", async () => {
    const { bot, action } = makeBot()
    const product = { id: "p0", name: "Producto p0", stock: 5, retailPrice: 10 }
    const prisma = { product: { findUnique: vi.fn(async () => product) } }
    const sessions = makeSessions()
    sessions.cart["555"] = fullCart()
    registerCart({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)
    const { callback, match } = action("addtocart_p0")
    const ctx = actionCtx(555, match)
    await callback(ctx)
    expect(sessions.cart["555"].items[0].quantity).toBe(2)
    expect(ctx.answerCbQuery).toHaveBeenCalledWith(expect.stringContaining("Agregado"))
  })

  it("/agregarc answers 'Carrito lleno' up front and skips the product search", async () => {
    const { bot, command } = makeBot()
    // requireAdminAccount usa el prisma inyectado (un solo findUnique por
    // comando — antes eran dos: isAdmin + getBotAccount).
    const userFindUnique = vi.fn(async () => adminAccount)
    const productFindMany = vi.fn(async () => [])
    const prisma = { user: { findUnique: userFindUnique }, product: { findMany: productFindMany } }
    const sessions = makeSessions()
    sessions.cart["555"] = fullCart()
    registerCart({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)
    const ctx = textCtx(555, "/agregarc pantalla")
    await command("agregarc")(ctx)
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Carrito lleno"), expect.anything())
    expect(productFindMany).not.toHaveBeenCalled()
    expect(userFindUnique).toHaveBeenCalledTimes(1)
    expect(mocks.requireAdmin).not.toHaveBeenCalled()
  })

  it("the digits handler refuses a new item past the cap and frees pendingAdd", async () => {
    const { bot, hears } = makeBot()
    const sessions = makeSessions()
    sessions.cart["555"] = { ...fullCart(), pendingAdd: { id: "pX", name: "Extra", price: 10, stock: 5 } }
    registerSales({ bot, prisma: {}, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)
    const ctx = textCtx(555, "2")
    await hears("2")(ctx, vi.fn(async () => {}))
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining(`${CART_MAX_ITEMS} productos`))
    expect(sessions.cart["555"].items).toHaveLength(CART_MAX_ITEMS)
    expect(sessions.cart["555"].pendingAdd).toBeUndefined()
  })

  it("rejects a quantity that would exceed stock for an item already in the cart", async () => {
    const { bot, hears } = makeBot()
    const sessions = makeSessions()
    sessions.cart["555"] = { items: [{ id: "p1", name: "X", quantity: 5, price: 10, stock: 6 }], pendingAdd: { id: "p1", name: "X", price: 10, stock: 6 } }
    registerSales({ bot, prisma: {}, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)
    const ctx = textCtx(555, "2")
    await hears("2")(ctx, vi.fn(async () => {}))
    // 5 + 2 = 7 > stock 6 — antes sumaba igual y /confirmarc reventaba.
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("7"))
    expect(sessions.cart["555"].items[0].quantity).toBe(5)
    expect(sessions.cart["555"].pendingAdd).toBeDefined()
  })

  it("adds the quantity normally when the cart has room", async () => {
    const { bot, hears } = makeBot()
    const sessions = makeSessions()
    sessions.cart["555"] = { items: [], pendingAdd: { id: "p1", name: "Pantalla", price: 100, stock: 5 } }
    registerSales({ bot, prisma: {}, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)
    const ctx = textCtx(555, "2")
    await hears("2")(ctx, vi.fn(async () => {}))
    expect(sessions.cart["555"].items[0]).toMatchObject({ id: "p1", quantity: 2 })
    expect(sessions.cart["555"].pendingAdd).toBeUndefined()
  })

  it("/carrito clips the listing under the 4096 limit", async () => {
    const { bot, command } = makeBot()
    const prisma = {}
    const sessions = makeSessions()
    sessions.cart["555"] = {
      items: Array.from({ length: CART_MAX_ITEMS }, (_, i) => ({ id: `p${i}`, name: `Refacción con nombre muy largo número ${i} `.repeat(4).trim(), quantity: 2, price: 12345, stock: 9 })),
    }
    registerCart({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)
    const ctx = textCtx(555, "/carrito")
    await command("carrito")(ctx)
    const sent = (ctx.reply.mock.calls[0] as unknown[])[0] as string
    expect(sent.length).toBeLessThanOrEqual(TG_MESSAGE_MAX)
  })
})

describe("confirm_cart answers every denial and never mislabels a confirmed sale", () => {
  beforeEach(() => vi.clearAllMocks())

  it("denies non-admins via answerCbQuery (the spinner is not left hanging)", async () => {
    const { bot, action } = makeBot()
    mocks.getBotAccount.mockResolvedValue({ ...adminAccount, role: "CUSTOMER" })
    const sessions = makeSessions()
    sessions.cart["555"] = { items: [cartItem("p1")] }
    registerCart({ bot, prisma: {}, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)
    const { callback, match } = action("confirm_cart")
    const ctx = actionCtx(555, match)
    await callback(ctx)
    expect(ctx.answerCbQuery).toHaveBeenCalledWith(expect.stringContaining("administradores"))
    expect(mocks.sell).not.toHaveBeenCalled()
  })

  it("still shows the success edit when the cb toast fails after sell() ran", async () => {
    const { bot, action } = makeBot()
    mocks.getBotAccount.mockResolvedValue(adminAccount)
    mocks.sell.mockResolvedValue({ total: 500 })
    const sessions = makeSessions()
    sessions.cart["555"] = { items: [cartItem("p1")] }
    registerCart({ bot, prisma: {}, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)
    const { callback, match } = action("confirm_cart")
    const ctx = actionCtx(555, match)
    ctx.answerCbQuery.mockRejectedValue(new Error("telegram timeout"))
    await callback(ctx)
    // La venta YA quedó: un toast fallido no debe reportar "Error" al cajero.
    expect(ctx.editMessageText).toHaveBeenCalledWith(expect.stringContaining("Venta Registrada"), expect.anything())
    expect(sessions.cart["555"]).toBeUndefined()
  })
})

describe("orden wizard reuses the businessId captured at /orden", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePrisma.mockResolvedValue(true)
    mocks.getBotAccount.mockResolvedValue(adminAccount)
  })

  it("orden_type_ does not re-read the account just to load brand chips", async () => {
    const { bot, action, command } = makeBot()
    const prisma = {
      systemSettings: { findUnique: vi.fn(async () => null) },
      deviceModel: { findMany: vi.fn(async () => [{ brand: "Apple" }]) },
      branch: { findMany: vi.fn(async () => [{ id: "b1", name: "Matriz" }]) },
      business: { findUnique: vi.fn(async () => ({ slug: "taller" })) },
      user: { findUnique: vi.fn(async () => null) },
    }
    const sessions = makeSessions()
    registerOrden({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)

    await command("orden")(textCtx(555, "/orden"))
    expect(sessions.orden["555"]).toMatchObject({ step: "NAME", businessId: "biz-own" })

    // El wizard avanza por el handler de texto registrado vía bot.on.
    const textHandler = (bot.on as any).mock.calls.map((c: any[]) => c[1]).find((fn: any) => typeof fn === "function")
    const next = vi.fn(async () => {})
    await textHandler(textCtx(555, "Juan Pérez"), next)
    await textHandler(textCtx(555, "5512345678"), next)
    expect(sessions.orden["555"].step).toBe("TYPE")

    const { callback, match } = action("orden_type_0")
    const ctx = actionCtx(555, match)
    await callback(ctx)
    expect(sessions.orden["555"].step).toBe("BRAND")
    expect(sessions.orden["555"].brandChips).toEqual(["Apple"])
    // Dedup medible: /orden leyó la cuenta una vez; los pasos siguientes usan
    // session.businessId — antes cada refreshBrandChips era otro findUnique.
    expect(mocks.getBotAccount).toHaveBeenCalledTimes(1)
  })
})
