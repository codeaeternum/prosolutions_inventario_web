import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Alertas Telegram por operación sensible (lib/operation-alerts): el dueño
 * se entera al instante cuando un NO-admin anula una venta, aplica un
 * conteo, carga crédito, paga a proveedor o cobra con descuento.
 * Solo la ejecución real alerta — un replay idempotente no repite el aviso.
 */

const mocks = vi.hoisted(() => ({
  sendTelegramToUsers: vi.fn(),
  userFindUnique: vi.fn(),
}))

vi.mock("@/lib/telegram", () => ({ sendTelegramToUsers: mocks.sendTelegramToUsers }))
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.userFindUnique } } }))

type OperationAlertsModule = typeof import("@/lib/operation-alerts")
type AlertInput = Parameters<OperationAlertsModule["alertSensitiveOperation"]>[0]

let mod: OperationAlertsModule
const alert = (input: AlertInput) => mod.alertSensitiveOperation(input)

const op = (over: Partial<AlertInput> = {}): AlertInput => ({
  businessId: "biz-1",
  actorId: "kevin-1",
  kind: "SALE_VOID",
  response: { number: 42 },
  executed: true,
  ...over,
})

const sentMessage = () => mocks.sendTelegramToUsers.mock.calls[0]?.[1] as string

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  mod = await import("@/lib/operation-alerts")
  mocks.userFindUnique.mockResolvedValue({ role: "EMPLOYEE", name: "Kevin" })
  mocks.sendTelegramToUsers.mockResolvedValue(1)
})

describe("alertSensitiveOperation", () => {
  it("avisa al dueño cuando un empleado anula una venta", async () => {
    await alert(op())
    expect(mocks.sendTelegramToUsers).toHaveBeenCalledTimes(1)
    const msg = sentMessage()
    expect(msg).toContain("Operación sensible")
    expect(msg).toContain("Kevin")
    expect(msg).toContain("Anuló una venta")
    expect(msg).toContain("V-42")
    expect(mocks.sendTelegramToUsers.mock.calls[0][0]).toBe("biz-1")
    expect(mocks.sendTelegramToUsers.mock.calls[0][2]).toEqual({ role: "ADMIN" })
  })

  it("no alerta un replay idempotente (executed=false)", async () => {
    await alert(op({ executed: false }))
    expect(mocks.sendTelegramToUsers).not.toHaveBeenCalled()
    expect(mocks.userFindUnique).not.toHaveBeenCalled()
  })

  it("no alerta operaciones no sensibles", async () => {
    await alert(op({ kind: "SALE", response: { number: 1 } }))
    await alert(op({ kind: "COUNT_CREATE" }))
    await alert(op({ kind: "PURCHASE_CREATE" }))
    expect(mocks.sendTelegramToUsers).not.toHaveBeenCalled()
  })

  it("no alerta cuando el actor es ADMIN", async () => {
    mocks.userFindUnique.mockResolvedValue({ role: "ADMIN", name: "Diego" })
    await alert(op())
    expect(mocks.sendTelegramToUsers).not.toHaveBeenCalled()
  })

  it("cada kind sensible trae su titular y detalle", async () => {
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ["SALE_RETURN", { refunded: 250 }, /devolución[\s\S]*reembolso \$250\.00/i],
      ["SALE_DOCUMENT_CANCEL", { folio: "V-000015" }, /Canceló un documento[\s\S]*V-000015/],
      ["COUNT_APPLY", { folio: "CC-000002", adjustments: 3, branchName: "Matriz" }, /conteo[\s\S]*CC-000002[\s\S]*3 ajuste/],
      ["DEBT", { creditBalance: 300 }, /crédito[\s\S]*saldo \$300\.00/i],
      ["SUPPLIER_PAYMENT", { folio: "OC-000004", amountCents: 150000 }, /proveedor[\s\S]*OC-000004[\s\S]*1,500/],
    ]
    for (const [kind, response, re] of cases) {
      vi.resetModules(); mod = await import("@/lib/operation-alerts"); vi.clearAllMocks()
      mocks.userFindUnique.mockResolvedValue({ role: "EMPLOYEE", name: "Kevin" })
      await alert(op({ kind, response }))
      expect(mocks.sendTelegramToUsers, kind).toHaveBeenCalledTimes(1)
      expect(sentMessage(), kind).toMatch(re)
    }
  })

  it("cobra con descuento alerta aunque CHECKOUT no esté en el set", async () => {
    await alert(op({
      kind: "SALE_DOCUMENT_CHECKOUT",
      response: { number: 7, discountCents: 5000, discountReason: "Cliente frecuente" },
    }))
    expect(mocks.sendTelegramToUsers).toHaveBeenCalledTimes(1)
    const msg = sentMessage()
    expect(msg).toContain("descuento")
    expect(msg).toContain("$50.00")
    expect(msg).toContain("Cliente frecuente")
  })

  it("checkout sin descuento no alerta", async () => {
    await alert(op({ kind: "SALE_DOCUMENT_CHECKOUT", response: { number: 7, discountCents: 0 } }))
    await alert(op({ kind: "SALE_DOCUMENT_CHECKOUT", response: { number: 7 } }))
    expect(mocks.sendTelegramToUsers).not.toHaveBeenCalled()
  })

  it("escapa HTML en motivo de descuento y datos del recibo", async () => {
    await alert(op({
      kind: "SALE_DOCUMENT_CHECKOUT",
      response: { number: 7, discountCents: 100, discountReason: "<b>trampa</b> & <script>" },
    }))
    const msg = sentMessage()
    expect(msg).not.toContain("<script>")
    expect(msg).not.toContain("<b>trampa</b>")
    expect(msg).toContain("&lt;b&gt;trampa&lt;/b&gt;")
  })

  it("anti-spam: mismo actor+kind en <60s solo avisa una vez", async () => {
    await alert(op())
    await alert(op({ response: { number: 99 } }))
    expect(mocks.sendTelegramToUsers).toHaveBeenCalledTimes(1)
  })

  it("kinds distintos no se throttean entre sí", async () => {
    await alert(op({ kind: "SALE_VOID" }))
    await alert(op({ kind: "SALE_RETURN", response: { refunded: 100 } }))
    expect(mocks.sendTelegramToUsers).toHaveBeenCalledTimes(2)
  })

  it("nunca lanza aunque prisma o Telegram fallen", async () => {
    mocks.userFindUnique.mockRejectedValue(new Error("db down"))
    await expect(alert(op())).resolves.toBeUndefined()
    mocks.userFindUnique.mockResolvedValue({ role: "EMPLOYEE", name: "Kevin" })
    mocks.sendTelegramToUsers.mockRejectedValue(new Error("telegram down"))
    await expect(alert(op({ kind: "COUNT_APPLY", response: { folio: "CC-1" } }))).resolves.toBeUndefined()
  })
})
