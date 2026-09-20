import { beforeEach, describe, expect, it, vi } from "vitest"
import type { BotContext } from "@/bot/lib/types"
import { BusinessError } from "@/lib/domain/operations"

// Los dominios se mockean: el test verifica el CONTRATO del bot con ellos
// (payload, guardias, idempotencia), no la lógica interna del taller.
const mocks = vi.hoisted(() => ({
  notifyAdmins: vi.fn(async () => {}),
  isAdmin: vi.fn(async () => true),
  createRepair: vi.fn(),
  delegateRepairToPartner: vi.fn(),
  resolveRepairPartner: vi.fn(),
}))
vi.mock("@/bot/lib/notify", () => ({ notifyAdmins: mocks.notifyAdmins, isAdmin: mocks.isAdmin }))
// requirePrisma se apaga (getPrisma devolvería null sin DATABASE_URL en test);
// getBotAccount queda real para ejercitar la guardia contra el prisma mockeado.
vi.mock("@/bot/lib/guards", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/bot/lib/guards")>()
  return { ...original, requirePrisma: vi.fn(async () => true) }
})
vi.mock("@/lib/domain/workshop", () => ({ createRepair: mocks.createRepair }))
vi.mock("@/lib/domain/delegation", () => ({
  delegateRepairToPartner: mocks.delegateRepairToPartner,
  resolveRepairPartner: mocks.resolveRepairPartner,
  REPAIR_PARTNER_KEY: "repair_partner_business_id",
}))
// lib/registration (escapeHtml) importa lib/settings → lib/prisma exigiría
// DATABASE_URL al cargar el módulo; se mockea entero como en los otros tests.
vi.mock("@/lib/settings", () => ({
  getBusinessSetting: vi.fn(async () => null),
  getBusinessSettingsMap: vi.fn(async () => new Map()),
  setBusinessSetting: vi.fn(async () => {}),
  getDefaultBusinessId: vi.fn(async () => "biz-test"),
  getOrderFolioDigits: vi.fn(async () => 6),
  DEFAULT_BUSINESS_ID: "biz-default",
}))

import { registerOrden } from "@/bot/commands/orden"
import { registerCancelar } from "@/bot/commands/cancelar"

type Handler = (ctx: any, next?: () => Promise<void>) => Promise<unknown>
function makeBot() {
  const actions: { trigger: string | RegExp; callback: Handler }[] = []
  const listeners: Handler[] = []
  const commands = new Map<string, Handler>()
  const bot = {
    command: (name: string, callback: Handler) => commands.set(name, callback),
    hears: vi.fn(),
    action: (trigger: string | RegExp, callback: Handler) => actions.push({ trigger, callback }),
    on: (_trigger: unknown, callback: Handler) => listeners.push(callback),
    telegram: { sendMessage: vi.fn(async () => ({})), getFile: vi.fn() },
  }
  const command = (name: string) => {
    const found = commands.get(name)
    if (!found) throw new Error(`No command registered for /${name}`)
    return found
  }
  const action = (data: string) => {
    const found = actions.find(({ trigger }) => trigger instanceof RegExp ? (trigger.lastIndex = 0, trigger.test(data)) : trigger === data)
    if (!found) throw new Error(`No action registered for ${data}`)
    return { callback: found.callback, match: found.trigger instanceof RegExp ? found.trigger.exec(data)! : null }
  }
  // Los listeners de texto se encadenan como en telegraf: cada uno recibe
  // `next` que ejecuta el resto de la cadena.
  const dispatchText = async (ctx: any) => {
    let index = 0
    const next = async (): Promise<void> => { if (index < listeners.length) await listeners[index++](ctx, next) }
    await next()
  }
  return { bot, command, action, listeners, dispatchText }
}
function makePrisma(user: any = staffUser()) {
  return {
    user: { findUnique: vi.fn(async () => user) },
    branch: { findMany: vi.fn(async () => [{ id: "br-1", name: "Centro" }]) },
    business: { findUnique: vi.fn(async () => ({ slug: "taller-demo" })) },
    systemSettings: { findUnique: vi.fn(async () => null) },
    deviceModel: { findMany: vi.fn(async () => [{ brand: "Apple" }, { brand: "Samsung" }]) },
  }
}
const staffUser = (overrides: any = {}) => ({
  id: "u-staff", businessId: "biz-cap", role: "EMPLOYEE", status: "APPROVED",
  name: "Luis Staff", allowedModules: ["taller"], allowedBranchIds: [], ...overrides,
})
const makeSessions = () => ({ registration: {}, adminProduct: {}, reservation: {}, deleteProduct: {}, sale: {}, cart: {}, qr: {}, settings: {}, orden: {} } as any)
const textCtx = (id: number, text: string) => ({
  from: { id }, chat: { type: "private" }, message: { text },
  reply: vi.fn(async () => ({})), answerCbQuery: vi.fn(async () => ({})), editMessageText: vi.fn(async () => ({})),
})
const actionCtx = (id: number, match: RegExpExecArray | null) => ({
  from: { id }, chat: { type: "private" }, match,
  reply: vi.fn(async () => ({})), answerCbQuery: vi.fn(async () => ({})), editMessageText: vi.fn(async () => ({})),
})
const registerAll = (bot: any, prisma: any, sessions: any) =>
  registerOrden({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)

describe("/orden wizard guard (staff + módulo taller)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("rejects unregistered, pending, customer and workshop-role users without opening a session", async () => {
    for (const [user, expected] of [
      [null, "cuenta registrada"],
      [staffUser({ status: "PENDING" }), "pendiente de aprobación"],
      [staffUser({ role: "CUSTOMER" }), "personal del negocio"],
      [staffUser({ role: "WORKSHOP" }), "personal del negocio"],
      [staffUser({ allowedModules: ["ventas"] }), "módulo de taller"],
    ] as const) {
      const { bot, command } = makeBot()
      const sessions = makeSessions()
      registerAll(bot, makePrisma(user), sessions)
      const ctx = textCtx(555, "/orden")
      await command("orden")(ctx)
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining(expected))
      expect(sessions.orden["555"]).toBeUndefined()
    }
  })

  it("opens the wizard for ADMIN and EMPLOYEE staff", async () => {
    for (const role of ["ADMIN", "EMPLOYEE"]) {
      const { bot, command } = makeBot()
      const sessions = makeSessions()
      registerAll(bot, makePrisma(staffUser({ role })), sessions)
      const ctx = textCtx(555, "/orden")
      await command("orden")(ctx)
      expect(sessions.orden["555"].step).toBe("NAME")
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Nombre del cliente"), expect.any(Object))
    }
  })

  it("fails cleanly when the business has no active branch", async () => {
    const { bot, command } = makeBot()
    const prisma = makePrisma()
    prisma.branch.findMany.mockResolvedValue([])
    const sessions = makeSessions()
    registerAll(bot, prisma, sessions)
    const ctx = textCtx(555, "/orden")
    await command("orden")(ctx)
    expect(sessions.orden["555"]).toBeUndefined()
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("sucursales activas"))
  })
})

describe("/orden wizard creates the repair via createRepair", () => {
  beforeEach(() => vi.clearAllMocks())

  async function runHappyPath(branchCount = 1) {
    const { bot, command, action, dispatchText } = makeBot()
    const prisma = makePrisma()
    prisma.branch.findMany.mockResolvedValue(
      Array.from({ length: branchCount }, (_, i) => ({ id: `br-${i + 1}`, name: `Sucursal ${i + 1}` })),
    )
    mocks.createRepair.mockResolvedValue({ order: { id: "o-1", number: 7 }, operationId: "op-1" })
    mocks.resolveRepairPartner.mockRejectedValue(new BusinessError("sin taller", 400, "PARTNER_NOT_CONFIGURED"))
    const sessions = makeSessions()
    registerAll(bot, prisma, sessions)

    await command("orden")(textCtx(555, "/orden"))
    await dispatchText(textCtx(555, "Juan Pérez"))
    expect(sessions.orden["555"].step).toBe("PHONE")
    await dispatchText(textCtx(555, "55 1234 5678"))
    expect(sessions.orden["555"].step).toBe("TYPE")

    const type = action("orden_type_0")
    await type.callback(actionCtx(555, type.match))
    expect(sessions.orden["555"].data.equipmentType).toBe("Celular")
    expect(sessions.orden["555"].step).toBe("BRAND")

    await dispatchText(textCtx(555, "Apple"))
    expect(sessions.orden["555"].step).toBe("MODEL")
    await dispatchText(textCtx(555, "iPhone 13"))
    expect(sessions.orden["555"].step).toBe("ISSUE")
    await dispatchText(textCtx(555, "No enciende, se apagó de repente"))
    return { action, dispatchText, sessions, prisma }
  }

  it("creates the order with the web-intake field shape and replies folio + tracking link", async () => {
    const { action, sessions } = await runHappyPath(1)
    // Una sola sucursal: el paso BRANCH se salta y va directo a CONFIRM.
    expect(sessions.orden["555"].step).toBe("CONFIRM")
    expect(sessions.orden["555"].data.branchId).toBe("br-1")

    const confirm = action("orden_confirm")
    const ctx = actionCtx(555, confirm.match)
    await confirm.callback(ctx)

    expect(mocks.createRepair).toHaveBeenCalledTimes(1)
    const [, actorId, businessId, payload] = mocks.createRepair.mock.calls[0] as any[]
    expect(actorId).toBe("u-staff")
    expect(businessId).toBe("biz-cap")
    expect(payload).toEqual({
      idempotencyKey: expect.stringMatching(/^bot-orden-555-\d+$/),
      customerName: "Juan Pérez",
      customerPhone: "525512345678", // 10 dígitos → +52 por normalizePhone
      equipmentType: "Celular",
      brand: "Apple",
      model: "iPhone 13",
      reportedIssue: "No enciende, se apagó de repente",
      intakeBranchId: "br-1",
    })
    expect(sessions.orden["555"]).toBeUndefined()
    const [successText, options] = ctx.editMessageText.mock.calls[0] as any[]
    expect(successText).toContain("OT-000007")
    expect(successText).toContain("taller-demo/order-status?folio=OT-000007&t=5678")
    // Sin taller asociado configurado no se ofrece la delegación.
    expect(JSON.stringify(options)).not.toContain("Enviar a taller")
    expect(mocks.notifyAdmins).toHaveBeenCalled()
  })

  it("adds the branch-picker step when the business has several branches", async () => {
    const { action, sessions } = await runHappyPath(2)
    expect(sessions.orden["555"].step).toBe("BRANCH")

    const pick = action("orden_branch_1")
    await pick.callback(actionCtx(555, pick.match))
    expect(sessions.orden["555"].step).toBe("CONFIRM")
    expect(sessions.orden["555"].data.branchId).toBe("br-2")

    const confirm = action("orden_confirm")
    await confirm.callback(actionCtx(555, confirm.match))
    expect((mocks.createRepair.mock.calls[0] as any[])[3].intakeBranchId).toBe("br-2")
  })

  it("keeps the session at CONFIRM when createRepair throws a BusinessError", async () => {
    const { action, sessions } = await runHappyPath(1)
    mocks.createRepair.mockReset()
    mocks.createRepair.mockRejectedValue(new BusinessError("Selecciona una sucursal activa."))
    const confirm = action("orden_confirm")
    const ctx = actionCtx(555, confirm.match)
    await confirm.callback(ctx)
    expect(sessions.orden["555"]?.step).toBe("CONFIRM")
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("sucursal activa"), expect.any(Object))
  })

  it("/cancelar clears the orden session", async () => {
    const { bot, command, dispatchText } = makeBot()
    const sessions = makeSessions()
    registerAll(bot, makePrisma(), sessions)
    registerCancelar(bot as any, {
      registration: sessions.registration, adminProduct: sessions.adminProduct,
      reservation: sessions.reservation, orden: sessions.orden,
    })
    await command("orden")(textCtx(555, "/orden"))
    await dispatchText(textCtx(555, "Juan Pérez"))
    expect(sessions.orden["555"]).toBeDefined()
    const ctx = textCtx(555, "/cancelar")
    await command("cancelar")(ctx)
    expect(sessions.orden["555"]).toBeUndefined()
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("cancelado"))
  })
})

describe("orden_delegate_* sends the order to the partner workshop", () => {
  beforeEach(() => vi.clearAllMocks())

  async function orderCreated() {
    const { bot, command, action, dispatchText } = makeBot()
    const prisma = makePrisma()
    mocks.createRepair.mockResolvedValue({ order: { id: "o-1", number: 7 }, operationId: "op-1" })
    mocks.resolveRepairPartner.mockResolvedValue({ repairerBusinessId: "biz-taller", repairerBusiness: { name: "Taller Pro" }, branch: { id: "br-t" }, repairerActor: { id: "u-t" }, partnerBusiness: { name: "Telcel" } })
    const sessions = makeSessions()
    registerAll(bot, prisma, sessions)
    await command("orden")(textCtx(555, "/orden"))
    await dispatchText(textCtx(555, "Juan Pérez"))
    await dispatchText(textCtx(555, "5512345678"))
    const type = action("orden_type_0")
    await type.callback(actionCtx(555, type.match))
    await dispatchText(textCtx(555, "saltar")) // marca omitida
    await dispatchText(textCtx(555, "saltar")) // modelo omitido
    await dispatchText(textCtx(555, "Pantalla rota"))
    const confirm = action("orden_confirm")
    const ctx = actionCtx(555, confirm.match)
    await confirm.callback(ctx)
    return { action, confirmCtx: ctx }
  }

  it("offers the delegate button only when the partner resolves, and delegates on tap", async () => {
    const { action, confirmCtx } = await orderCreated()
    expect(JSON.stringify((confirmCtx.editMessageText.mock.calls[0] as any[])[1])).toContain("orden_delegate_o-1")

    mocks.delegateRepairToPartner.mockResolvedValue({
      delegated: true, alreadyDelegated: false, mirrorOrderId: "m-9", mirrorFolio: "OT-000042", partnerName: "Taller Pro",
    })
    const delegate = action("orden_delegate_o-1")
    const ctx = actionCtx(555, delegate.match)
    await delegate.callback(ctx)
    expect(mocks.delegateRepairToPartner).toHaveBeenCalledWith(expect.anything(), "u-staff", "biz-cap", "o-1")
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("OT-000042"), expect.any(Object))
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Taller Pro"), expect.any(Object))
  })

  it("reports an already-delegated order without duplicating the mirror", async () => {
    const { action } = await orderCreated()
    mocks.delegateRepairToPartner.mockResolvedValue({
      delegated: true, alreadyDelegated: true, mirrorOrderId: "m-9", mirrorFolio: "OT-000042", partnerName: "Taller Pro",
    })
    const delegate = action("orden_delegate_o-1")
    const ctx = actionCtx(555, delegate.match)
    await delegate.callback(ctx)
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("ya había sido enviada"), expect.any(Object))
  })

  it("rejects delegation from a non-staff account", async () => {
    const { bot, action } = makeBot()
    const prisma = makePrisma(staffUser({ role: "CUSTOMER" }))
    registerAll(bot, prisma, makeSessions())
    const delegate = action("orden_delegate_o-1")
    const ctx = actionCtx(555, delegate.match)
    await delegate.callback(ctx)
    expect(mocks.delegateRepairToPartner).not.toHaveBeenCalled()
  })
})
