import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { jitterMs, withLatencyFloor } from "@/lib/timing"

/**
 * Piso de latencia anti-enumeración en /api/auth/password-reset/request.
 *
 * Antes del piso, la rama "la cuenta existe" pagaba issueVerificationCode +
 * Resend + Telegram (~200-800 ms) mientras la "no existe" respondía en ~10 ms:
 * una request >300 ms confirmaba la cuenta aunque status y body fueran
 * idénticos. Ahora work + sleep(500-800 ms, jitter con crypto.randomInt) corren
 * en Promise.all: ninguna rama baja del piso y el jitter impide que el propio
 * umbral las distinga.
 *
 * Estos tests corren con fake timers: los "ms" son virtuales pero el orden
 * (work vs. sleep) y las cotas se verifican exactas — la entrega lenta/rápida
 * se mockea con setTimeout para hacer determinista el contraste de ramas.
 */

const mocks = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  userFindFirst: vi.fn(),
  issueVerificationCode: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendTelegramMessage: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: mocks.userFindMany, findFirst: mocks.userFindFirst },
  },
}))

vi.mock("@/lib/verification", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/verification")>()
  return { ...actual, issueVerificationCode: mocks.issueVerificationCode }
})

vi.mock("@/lib/mailer", () => ({
  sendPasswordResetEmail: mocks.sendPasswordResetEmail,
}))

vi.mock("@/lib/telegram", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/telegram")>()
  return { ...actual, sendTelegramMessage: mocks.sendTelegramMessage }
})

// @/lib/rate-limit queda REAL (en memoria): cada request lleva identifier e IP
// distintos, así que los buckets nunca se llenan dentro del test.

import { POST as requestReset } from "@/app/api/auth/password-reset/request/route"

vi.stubEnv("TRUST_PROXY_HEADERS", "true")
let ipCounter = 0
const nextIp = () => `10.99.${(++ipCounter) % 250}.${(ipCounter * 7) % 250 + 1}`

const reqPost = (identifier: string) =>
  new Request("https://app.invalid/api/auth/password-reset/request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": nextIp(),
    },
    body: JSON.stringify({ identifier }),
  })

const existingUser = {
  id: "u-1",
  businessId: "biz-1",
  email: "usuario@taller.mx",
  phone: "5512345678",
  telegramId: null,
  status: "APPROVED",
  business: { name: "Taller", isActive: true },
}

const delayed = <T>(value: T, ms: number) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms))

/**
 * Dispara la request y avanza el reloj virtual hasta que resuelva; devuelve
 * la respuesta y el tiempo de resolución medido con el reloj falso.
 */
async function timedRequest(req: Request): Promise<{ res: Response; elapsedMs: number }> {
  const start = Date.now()
  let resolvedAt: number | null = null
  const pending = requestReset(req).then((r) => {
    resolvedAt = Date.now()
    return r
  })
  // Avanza en pasos de 10 ms hasta que la promesa se resuelva (techo de
  // seguridad: 60 s virtuales — de sobra para el caso lento de ~1.2 s).
  for (let i = 0; i < 6000 && resolvedAt === null; i++) {
    await vi.advanceTimersByTimeAsync(10)
  }
  const res = await pending
  if (resolvedAt === null) throw new Error("la request no resolvió")
  return { res, elapsedMs: resolvedAt - start }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.userFindMany.mockResolvedValue([])
  mocks.userFindFirst.mockResolvedValue(null)
  mocks.issueVerificationCode.mockResolvedValue({
    code: "654321",
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  })
  mocks.sendPasswordResetEmail.mockResolvedValue({ sent: true })
  mocks.sendTelegramMessage.mockResolvedValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("withLatencyFloor (lib)", () => {
  it("un trabajo instantáneo no resuelve antes del piso y nunca lo excede por arriba", async () => {
    const start = Date.now()
    let doneAt: number | null = null
    const pending = withLatencyFloor(async () => 42).then((v) => {
      doneAt = Date.now()
      return v
    })
    for (let i = 0; i < 200 && doneAt === null; i++) {
      await vi.advanceTimersByTimeAsync(10)
    }
    expect(await pending).toBe(42)
    expect(doneAt! - start).toBeGreaterThanOrEqual(500)
    expect(doneAt! - start).toBeLessThanOrEqual(800)
  })

  it("un trabajo más lento que el piso resuelve cuando termina (mínimo, no techo)", async () => {
    const start = Date.now()
    let doneAt: number | null = null
    const pending = withLatencyFloor(async () => delayed("lento", 1200)).then((v) => {
      doneAt = Date.now()
      return v
    })
    for (let i = 0; i < 400 && doneAt === null; i++) {
      await vi.advanceTimersByTimeAsync(10)
    }
    expect(await pending).toBe("lento")
    expect(doneAt! - start).toBeGreaterThanOrEqual(1200)
  })

  it("jitterMs devuelve enteros uniformes dentro de [min, max]", () => {
    for (let i = 0; i < 200; i++) {
      const v = jitterMs(500, 800)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(500)
      expect(v).toBeLessThanOrEqual(800)
    }
  })
})

describe("POST /api/auth/password-reset/request — piso anti-enumeración", () => {
  it("cuenta inexistente (trabajo ~0 ms): la respuesta nunca baja del piso [500, 800]", async () => {
    mocks.userFindMany.mockResolvedValue([])
    const { res, elapsedMs } = await timedRequest(reqPost("nadie@taller.mx"))
    expect(res.status).toBe(200)
    expect(mocks.issueVerificationCode).not.toHaveBeenCalled()
    expect(elapsedMs).toBeGreaterThanOrEqual(500)
    expect(elapsedMs).toBeLessThanOrEqual(800)
  })

  it("cuenta existente con entrega ~350 ms cae en la MISMA ventana [500, 800]", async () => {
    mocks.userFindMany.mockResolvedValue([existingUser])
    mocks.sendPasswordResetEmail.mockImplementation(() => delayed({ sent: true }, 350))
    const { res, elapsedMs } = await timedRequest(reqPost("usuario@taller.mx"))
    expect(res.status).toBe(200)
    expect(mocks.issueVerificationCode).toHaveBeenCalled()
    expect(mocks.sendPasswordResetEmail).toHaveBeenCalled()
    expect(elapsedMs).toBeGreaterThanOrEqual(500)
    expect(elapsedMs).toBeLessThanOrEqual(800)
  })

  it("ambas ramas caen en la misma ventana y devuelven status/body idénticos", async () => {
    mocks.userFindMany.mockResolvedValue([existingUser])
    mocks.sendPasswordResetEmail.mockImplementation(() => delayed({ sent: true }, 300))
    const existing = await timedRequest(reqPost("usuario@taller.mx"))

    mocks.userFindMany.mockResolvedValue([])
    const missing = await timedRequest(reqPost("nadie@taller.mx"))

    expect(existing.res.status).toBe(missing.res.status)
    expect(await existing.res.json()).toEqual(await missing.res.json())
    for (const elapsed of [existing.elapsedMs, missing.elapsedMs]) {
      expect(elapsed).toBeGreaterThanOrEqual(500)
      expect(elapsed).toBeLessThanOrEqual(800)
    }
  })

  it("entrega más lenta que el piso (>1.2 s): resuelve al terminar el trabajo, no antes", async () => {
    mocks.userFindMany.mockResolvedValue([existingUser])
    mocks.sendPasswordResetEmail.mockImplementation(() => delayed({ sent: true }, 1200))
    const { elapsedMs } = await timedRequest(reqPost("usuario@taller.mx"))
    expect(elapsedMs).toBeGreaterThanOrEqual(1200)
  })
})
