import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocked = vi.hoisted(() => ({
  prisma: {
    user: { aggregate: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    creditMovement: { findUnique: vi.fn(), findMany: vi.fn(), aggregate: vi.fn() },
    systemSettings: { findUnique: vi.fn() },
    business: { findUnique: vi.fn() },
  },
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND") }),
}))
vi.mock("@/lib/prisma", () => ({ default: mocked.prisma, prisma: mocked.prisma }))
vi.mock("@/lib/api-auth", () => ({
  requireAdmin: async () => ({ session: { user: { id: "admin", role: "ADMIN", businessId: "biz-test" } } }),
  requireAdminOrEmployee: async () => ({ session: { user: { id: "admin", role: "ADMIN", businessId: "biz-test" } } }),
  requireModule: async () => ({ session: { user: { id: "admin", role: "ADMIN", businessId: "biz-test" } } }),
  requireAuth: vi.fn(),
  getSession: vi.fn((result: { session?: unknown }) => result.session ?? null),
}))
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: mocked.notFound }))
vi.mock("@/app/admin/tickets/[tipo]/[id]/ticket-print-view", () => ({ TicketPrintView: () => null }))

import { GET } from "@/app/api/credit/movements/route"
import TicketPage from "@/app/admin/tickets/[tipo]/[id]/page"

describe("credit reversal presentation", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(["REVERSAL", "DEBT"])("refuses to print %s as an abono receipt", async type => {
    mocked.prisma.creditMovement.findUnique.mockResolvedValue({ id: "credit-entry", type, amount: 100, user: { name: "Fixture" } })
    await expect(TicketPage({ params: Promise.resolve({ tipo: "abono", id: "credit-entry" }) })).rejects.toThrow("NEXT_NOT_FOUND")
    expect(mocked.notFound).toHaveBeenCalledOnce()
    expect(mocked.prisma.systemSettings.findUnique).not.toHaveBeenCalled()
  })

  it("keeps reversal movements visible but excludes them from money collected", async () => {
    const entries = [{ id: "paid", type: "PAYMENT", amount: 50 }, { id: "reversed", type: "REVERSAL", amount: 100 }]
    mocked.prisma.user.aggregate.mockResolvedValue({ _sum: { creditBalance: 25 } })
    mocked.prisma.user.count.mockResolvedValue(1)
    mocked.prisma.user.findMany.mockResolvedValue([])
    mocked.prisma.creditMovement.findMany.mockResolvedValue(entries)
    mocked.prisma.creditMovement.aggregate.mockImplementation(async ({ where }) => ({ _sum: { amount: entries.filter(entry => entry.type === where.type).reduce((sum, entry) => sum + entry.amount, 0) } }))
    mocked.prisma.business.findUnique.mockResolvedValue({ name: "Negocio Fixture" })
    const response = await GET(new NextRequest("http://localhost/api/credit/movements?summary=true"))
    expect(await response.json()).toMatchObject({ monthPayments: 50, movements: entries })
  })
})
