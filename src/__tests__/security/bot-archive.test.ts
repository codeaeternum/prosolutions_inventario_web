import { beforeEach, describe, expect, it, vi } from "vitest"
import type { BotContext } from "@/bot/lib/types"
import { registerSales } from "@/bot/commands/sales"

const guards = vi.hoisted(() => ({ requireAdmin: vi.fn(), requirePrisma: vi.fn() }))
vi.mock("@/bot/lib/guards", () => guards)
vi.mock("@/bot/lib/notify", () => ({ notifyAdmins: vi.fn() }))

function fixture(currentRole = "ADMIN", currentStatus = "APPROVED") {
  const handlers: { pattern: RegExp; callback: (ctx: unknown) => Promise<unknown> }[] = []
  const product = { update: vi.fn().mockResolvedValue({ id: "product", isActive: false }), delete: vi.fn() }
  const tx = { product, user: { findUnique: vi.fn().mockResolvedValue({ id: "actor", role: currentRole, status: currentStatus }) } }
  const prisma = { $transaction: vi.fn(async (work: (value: unknown) => Promise<unknown>) => work(tx)) }
  const sessions = { deleteProduct: { "123": { step: "CONFIRM", selectedProduct: { id: "product", name: "Fixture" } } }, sale: {}, cart: {}, qr: {}, registration: {} }
  const bot = { command: vi.fn(), action: vi.fn(), hears: (pattern: RegExp, callback: (ctx: unknown) => Promise<unknown>) => handlers.push({ pattern, callback }) }
  registerSales({ bot, prisma, sessions, isDev: false, BOT_TOKEN: "" } as unknown as BotContext)
  const confirmation = handlers.find(handler => handler.pattern.test("SI"))!
  const ctx = { from: { id: 123 }, chat: { type: "private" }, reply: vi.fn() }
  return { product, prisma, sessions, ctx, confirm: () => confirmation.callback(ctx) }
}

describe("legacy Telegram SI archival confirmation (no bot process or network)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    guards.requireAdmin.mockResolvedValue(true)
    guards.requirePrisma.mockResolvedValue(true)
  })
  it("archives the product while preserving its stock and ledger relations", async () => {
    const f = fixture()
    await f.confirm()
    expect(f.product.update).toHaveBeenCalledWith({ where: { id: "product" }, data: { isActive: false } })
    expect(f.product.delete).not.toHaveBeenCalled()
    expect(f.ctx.reply).toHaveBeenCalledWith(expect.stringContaining("movimientos se conservaron"), expect.any(Object))
    expect(f.sessions.deleteProduct["123"]).toBeUndefined()
  })
  it("denies stale confirmation after the admin role was revoked", async () => {
    const f = fixture("CUSTOMER")
    await f.confirm()
    expect(f.product.update).not.toHaveBeenCalled()
    expect(f.product.delete).not.toHaveBeenCalled()
  })
  it("denies stale confirmation after the account was rejected", async () => {
    const f = fixture("ADMIN", "REJECTED")
    await f.confirm()
    expect(f.product.update).not.toHaveBeenCalled()
    expect(f.product.delete).not.toHaveBeenCalled()
  })
  it("does not attempt a transaction if the private-admin guard refuses it", async () => {
    guards.requireAdmin.mockResolvedValue(false)
    const f = fixture()
    await f.confirm()
    expect(f.prisma.$transaction).not.toHaveBeenCalled()
  })
})
