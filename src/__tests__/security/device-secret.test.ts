import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Dato de desbloqueo cifrado en reposo: helpers AES-256-GCM de
 * src/lib/device-secret y el reveal auditado de GET /api/workshop/[id]
 * (?reveal=1 devuelve el valor y deja un RepairEvent interno; sin él la
 * ficha viaja con deviceAccessValue null).
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  orderFindUnique: vi.fn(),
  eventCreate: vi.fn(),
  eventFindFirst: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    repairOrder: { findUnique: mocks.orderFindUnique },
    repairEvent: { create: mocks.eventCreate, findFirst: mocks.eventFindFirst },
  },
}))
vi.mock("@/lib/domain/workshop", () => ({ createRepair: vi.fn(), updateRepair: vi.fn() }))
vi.mock("@/app/api/notifications/stream/route", () => ({ sendNotificationToStaff: vi.fn(async () => {}) }))

import { decryptAccessValue, encryptAccessValue, isEncryptedValue } from "@/lib/device-secret"
import { GET as workshopDetail } from "@/app/api/workshop/[id]/route"

const KEY = "a".repeat(64) // hex de 32 bytes
const OTHER_KEY = "b".repeat(64)

const session = (role: string) => ({
  user: { id: `u-${role}`, role, status: "APPROVED", businessId: "biz-1" },
})
const idParams = { params: Promise.resolve({ id: "order-1" }) }
const detailReq = (query = "") => new Request(`https://app.invalid/api/workshop/order-1${query}`)

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv("DEVICE_SECRET_KEY", KEY)
  vi.clearAllMocks()
  mocks.eventCreate.mockResolvedValue({})
})

describe("device-secret (AES-256-GCM)", () => {
  it("cifra y descifra con formato v1:iv:tag:cipher", () => {
    const stored = encryptAccessValue("0-3-6-8")
    expect(stored.startsWith("v1:")).toBe(true)
    expect(stored.split(":")).toHaveLength(4)
    expect(isEncryptedValue(stored)).toBe(true)
    expect(decryptAccessValue(stored)).toBe("0-3-6-8")
  })

  it("el texto plano heredado pasa tal cual — no hace falta migrar filas viejas", () => {
    expect(isEncryptedValue("1234")).toBe(false)
    expect(decryptAccessValue("1234")).toBe("1234")
    expect(decryptAccessValue("patron raro: con dos puntos")).toBe("patron raro: con dos puntos")
  })

  it("clave equivocada: decryptAccessValue LANZA, nunca devuelve basura", () => {
    const stored = encryptAccessValue("2468")
    vi.stubEnv("DEVICE_SECRET_KEY", OTHER_KEY)
    expect(() => decryptAccessValue(stored)).toThrow()
  })

  it("ciphertext alterado: la etiqueta GCM lo rechaza", () => {
    const stored = encryptAccessValue("2468")
    const parts = stored.split(":")
    const cipher = Buffer.from(parts[3], "base64")
    cipher[0] = cipher[0] ^ 0xff
    parts[3] = cipher.toString("base64")
    expect(() => decryptAccessValue(parts.join(":"))).toThrow()
    // También un auth tag alterado o un payload malformado.
    parts[3] = encryptAccessValue("x").split(":")[3]
    expect(() => decryptAccessValue(parts.join(":"))).toThrow()
    expect(() => decryptAccessValue("v1:solo-dos:partes")).toThrow()
  })

  it("deriva la clave de NEXTAUTH_SECRET cuando DEVICE_SECRET_KEY no está", () => {
    vi.stubEnv("DEVICE_SECRET_KEY", "")
    vi.stubEnv("NEXTAUTH_SECRET", "nextauth-secret-de-prueba")
    const stored = encryptAccessValue("patron-1-2-3")
    expect(decryptAccessValue(stored)).toBe("patron-1-2-3")
  })
})

describe("GET /api/workshop/[id] — reveal auditado", () => {
  const order = {
    id: "order-1", businessId: "biz-1", number: 7, status: "IN_REPAIR",
    customerName: "Ana", customerPhone: "5512341234",
    deviceAccessType: "PIN", deviceAccessValue: null as string | null,
  }

  it("sin ?reveal=1 devuelve deviceAccessValue null pero conserva el tipo", async () => {
    mocks.auth.mockResolvedValue(session("EMPLOYEE"))
    mocks.orderFindUnique.mockResolvedValue({ ...order, deviceAccessValue: encryptAccessValue("2468") })
    const res = await workshopDetail(detailReq(), idParams)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.order.deviceAccessValue).toBeNull()
    expect(json.order.deviceAccessType).toBe("PIN")
    expect(mocks.eventCreate).not.toHaveBeenCalled()
  })

  it("?reveal=1 devuelve el PIN en claro y registra quién lo consultó", async () => {
    mocks.auth.mockResolvedValue(session("EMPLOYEE"))
    mocks.orderFindUnique.mockResolvedValue({ ...order, deviceAccessValue: encryptAccessValue("2468") })
    const res = await workshopDetail(detailReq("?reveal=1"), idParams)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.order.deviceAccessValue).toBe("2468")
    expect(mocks.eventCreate).toHaveBeenCalledTimes(1)
    const { data } = mocks.eventCreate.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(data).toMatchObject({
      businessId: "biz-1", actorId: "u-EMPLOYEE", orderId: "order-1",
      type: "NOTE", detail: "Consultó el dato de desbloqueo del equipo", isPublic: false,
    })
  })

  it("?reveal=1 también revela texto plano heredado (órdenes previas al cifrado)", async () => {
    mocks.auth.mockResolvedValue(session("ADMIN"))
    mocks.orderFindUnique.mockResolvedValue({ ...order, deviceAccessValue: "2468" })
    const res = await workshopDetail(detailReq("?reveal=1"), idParams)
    const json = await res.json()
    expect(json.order.deviceAccessValue).toBe("2468")
    expect(mocks.eventCreate).toHaveBeenCalledTimes(1)
  })

  it("?reveal=1 en orden sin credencial no audita ni devuelve nada", async () => {
    mocks.auth.mockResolvedValue(session("EMPLOYEE"))
    mocks.orderFindUnique.mockResolvedValue({ ...order, deviceAccessType: "NONE", deviceAccessValue: null })
    const res = await workshopDetail(detailReq("?reveal=1"), idParams)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.order.deviceAccessValue).toBeNull()
    expect(mocks.eventCreate).not.toHaveBeenCalled()
  })

  it("valor ilegible por clave rotada: la ficha se sirve sin código y el intento queda auditado", async () => {
    mocks.auth.mockResolvedValue(session("EMPLOYEE"))
    mocks.orderFindUnique.mockResolvedValue({ ...order, deviceAccessValue: encryptAccessValue("2468") })
    vi.stubEnv("DEVICE_SECRET_KEY", OTHER_KEY)
    const res = await workshopDetail(detailReq("?reveal=1"), idParams)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.order.deviceAccessValue).toBeNull()
    expect(mocks.eventCreate).toHaveBeenCalledTimes(1)
  })
})
