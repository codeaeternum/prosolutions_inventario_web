import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * POST /api/purchases/[id] — idempotencyKey obligatoria del cliente en
 * RECEIVE_PARTIAL (auditoría D7).
 *
 * A diferencia de ORDER/RECEIVE/CANCEL —transiciones idempotentes por estado:
 * reintentarlas sobre una OC ya movida rebota en la máquina de estados— una
 * recepción parcial deja la OC en ORDERED, así que un retry tras timeout con
 * una llave inventada en servidor (crypto.randomUUID() de respaldo) ejecutaba
 * la entrada de stock DOS veces. Por eso RECEIVE_PARTIAL exige la llave del
 * cliente: el mismo reenvío repite la misma llave y operation() devuelve el
 * recibo guardado sin re-ejecutar. Las demás acciones conservan el respaldo.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  purchaseFindFirst: vi.fn(),
  setPurchaseStatus: vi.fn(),
  updatePurchaseDraft: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    purchase: { findFirst: mocks.purchaseFindFirst },
  },
}))
vi.mock("@/lib/domain/purchasing", () => ({
  setPurchaseStatus: mocks.setPurchaseStatus,
  updatePurchaseDraft: mocks.updatePurchaseDraft,
}))

import type { NextRequest } from "next/server"
import { POST } from "@/app/api/purchases/[id]/route"

/** Las rutas con NextRequest reciben el Request del test casteado (solo se leen body y headers). */
const nx = (req: Request) => req as unknown as NextRequest

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    nx(new Request("https://app.invalid/api/purchases/pur-1", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    })),
    { params: Promise.resolve({ id: "pur-1" }) },
  )

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({
    user: { id: "u-admin", role: "ADMIN", status: "APPROVED", businessId: "biz-1" },
  })
  mocks.purchaseFindFirst.mockResolvedValue({ branchId: "b-1" })
  mocks.setPurchaseStatus.mockResolvedValue({ purchaseId: "pur-1", status: "ORDERED" })
})

describe("POST /api/purchases/[id] — RECEIVE_PARTIAL exige llave de cliente", () => {
  it("rechaza con 400 claro una recepción parcial SIN idempotencyKey y no toca el dominio", async () => {
    const res = await post({ action: "RECEIVE_PARTIAL", items: [{ purchaseItemId: "pi-1", quantity: 2 }] })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/idempotencyKey/)
    expect(json.error).toMatch(/duplicar/i)
    expect(mocks.setPurchaseStatus).not.toHaveBeenCalled()
  })

  it("también rechaza una llave vacía o en blanco (no cuenta como llave de cliente)", async () => {
    for (const empty of ["", "   "]) {
      const res = await post({ action: "RECEIVE_PARTIAL", items: [{ purchaseItemId: "pi-1", quantity: 2 }], idempotencyKey: empty })
      expect(res.status).toBe(400)
    }
    expect(mocks.setPurchaseStatus).not.toHaveBeenCalled()
  })

  it("acepta la llave en el body y la pasa intacta al dominio", async () => {
    const res = await post({
      action: "RECEIVE_PARTIAL",
      items: [{ purchaseItemId: "pi-1", quantity: 2 }],
      idempotencyKey: "cliente-uuid-123",
    })
    expect(res.status).toBe(200)
    expect(mocks.setPurchaseStatus).toHaveBeenCalledTimes(1)
    const args = mocks.setPurchaseStatus.mock.calls[0]
    expect(args[4]).toMatchObject({ action: "RECEIVE_PARTIAL", idempotencyKey: "cliente-uuid-123" })
  })

  it("acepta la llave por header idempotency-key cuando el body no la trae", async () => {
    const res = await post(
      { action: "RECEIVE_PARTIAL", items: [{ purchaseItemId: "pi-1", quantity: 2 }] },
      { "idempotency-key": "header-key-456" },
    )
    expect(res.status).toBe(200)
    expect(mocks.setPurchaseStatus.mock.calls[0][4]).toMatchObject({ idempotencyKey: "header-key-456" })
  })

  it("la llave del body tiene prioridad sobre la del header", async () => {
    const res = await post(
      { action: "RECEIVE_PARTIAL", items: [{ purchaseItemId: "pi-1", quantity: 1 }], idempotencyKey: "body-key" },
      { "idempotency-key": "header-key" },
    )
    expect(res.status).toBe(200)
    expect(mocks.setPurchaseStatus.mock.calls[0][4]).toMatchObject({ idempotencyKey: "body-key" })
  })

  it("ORDER sin llave sigue pasando con respaldo aleatorio (es idempotente por estado)", async () => {
    const res = await post({ action: "ORDER" })
    expect(res.status).toBe(200)
    const key = mocks.setPurchaseStatus.mock.calls[0][4].idempotencyKey
    // El respaldo es un UUID generado en servidor: formato uuid v4.
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it("CANCEL sin llave sigue pasando con respaldo aleatorio", async () => {
    const res = await post({ action: "CANCEL" })
    expect(res.status).toBe(200)
    expect(mocks.setPurchaseStatus).toHaveBeenCalledTimes(1)
  })

  it("RECEIVE (completa) sin llave sigue pasando: termina en estado terminal", async () => {
    const res = await post({ action: "RECEIVE" })
    expect(res.status).toBe(200)
    expect(mocks.setPurchaseStatus).toHaveBeenCalledTimes(1)
  })
})
