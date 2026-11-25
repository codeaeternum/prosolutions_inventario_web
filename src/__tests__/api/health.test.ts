import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * GET /api/health — readiness de la app, en dos ramas:
 *
 *   - Rama liviana (anónimo): {status:"ok",ok,timestamp} sin tocar BD ni fs.
 *     Es lo que golpea el healthcheck de Docker cada 30 s (wget --spider solo
 *     mira el status) — antes cada GET ejecutaba mkdir+statfs+~10 queries
 *     sin auth ni rate-limit: un amplificador gratis para cualquiera.
 *   - Rama profunda (disco + schema): solo con sesión o con ?deep=1 +
 *     CRON_SECRET (Authorization Bearer / x-cron-secret). Reporta el
 *     directorio de comprobantes (>=500 MB libres) y las 10 consultas
 *     LIMIT 0 + _prisma_migrations sin fallos.
 */

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  mkdir: vi.fn(),
  statfs: vi.fn(),
  access: vi.fn(),
  auth: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction, $queryRaw: mocks.queryRaw },
}))
// El path real depende de PAYMENT_PROOFS_DIR; al test le basta una constante.
vi.mock("@/lib/payment-proofs", () => ({
  paymentProofDirectory: () => "/app/storage/payment-proofs",
}))
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: mocks.mkdir,
      statfs: mocks.statfs,
      access: mocks.access,
    },
  }
})

import { GET } from "@/app/api/health/route"

/** statfs con ~40 GB libres (bavail × bsize). */
const PLENTY = { bavail: 10_000_000, bsize: 4096 }
const MIN_FREE = 500 * 1024 * 1024

const req = (url = "https://app.invalid/api/health", headers: Record<string, string> = {}) =>
  new Request(url, { headers })
const withSession = () =>
  mocks.auth.mockResolvedValue({ user: { id: "u1", role: "ADMIN", status: "APPROVED" } })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(null) // llamada anónima (Docker healthcheck)
  mocks.transaction.mockResolvedValue([[]]) // _prisma_migrations sin fallos
  mocks.mkdir.mockResolvedValue(undefined)
  mocks.statfs.mockResolvedValue(PLENTY)
  mocks.access.mockResolvedValue(undefined)
  vi.stubEnv("CRON_SECRET", "test-cron-secret")
})
afterEach(() => { vi.unstubAllEnvs() })

describe("GET /api/health — rama liviana anónima", () => {
  it("responde 200 ok sin tocar la base de datos ni el filesystem", async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("ok")
    expect(body.ok).toBe(true)
    expect(body.timestamp).toBeDefined()
    // La rama liviana no ejecuta ni el statfs/mkdir ni las 10 queries.
    expect(mocks.statfs).not.toHaveBeenCalled()
    expect(mocks.mkdir).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    // Y no filtra telemetría interna (disco/schema) al anónimo.
    expect("disk" in body).toBe(false)
    expect("schema" in body).toBe(false)
  })

  it("?deep pelado (sin secreto) sigue en la rama liviana", async () => {
    const res = await GET(req("https://app.invalid/api/health?deep=1"))
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe("ok")
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.statfs).not.toHaveBeenCalled()
  })

  it("?deep con secreto incorrecto también cae en la rama liviana", async () => {
    const res = await GET(req("https://app.invalid/api/health?deep=1", { "x-cron-secret": "wrong" }))
    expect(res.status).toBe(200)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("el check de Docker (wget --spider, sin headers ni sesión) recibe 200 barato", async () => {
    const res = await GET(new Request("http://127.0.0.1:3000/api/health"))
    expect(res.status).toBe(200)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})

describe("GET /api/health — rama profunda con sesión", () => {
  it("responde 200 con schema ready y métricas de disco exactas", async () => {
    withSession()
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("ok")
    expect(body.schema).toBe("ready")
    expect(body.disk).toMatchObject({
      ok: true,
      writable: true,
      freeBytes: PLENTY.bavail * PLENTY.bsize,
      minFreeBytes: MIN_FREE,
    })
    // El path del volumen no se expone ni en la rama autenticada.
    expect(JSON.stringify(body)).not.toContain("payment-proofs")
    expect(mocks.statfs).toHaveBeenCalledWith("/app/storage/payment-proofs")
    expect(mocks.access).toHaveBeenCalledWith("/app/storage/payment-proofs", 2) // W_OK
  })

  it("una migración fallida responde 503 migration_failed (e incluye el disco)", async () => {
    withSession()
    mocks.transaction.mockResolvedValue([[{ migration_name: "20250101000000_stuck" }]])
    const res = await GET(req())
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.status).toBe("degraded")
    expect(body.schema).toBe("migration_failed")
    expect(body.disk.ok).toBe(true)
  })

  it("la BD caída responde 503 schema unavailable", async () => {
    withSession()
    mocks.transaction.mockRejectedValue(new Error("connection refused"))
    const res = await GET(req())
    expect(res.status).toBe(503)
    expect((await res.json()).schema).toBe("unavailable")
  })

  it("menos de 500 MB libres degrada a 503 aunque el schema esté listo", async () => {
    withSession()
    mocks.statfs.mockResolvedValue({ bavail: Math.floor((100 * 1024 * 1024) / 4096), bsize: 4096 })
    const res = await GET(req())
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.status).toBe("degraded")
    expect(body.schema).toBe("ready")
    expect(body.disk).toMatchObject({ ok: false, writable: true })
  })

  it("un directorio no escribible (access W_OK falla) degrada a 503", async () => {
    withSession()
    mocks.access.mockRejectedValue(Object.assign(new Error("EACCES"), { code: "EACCES" }))
    const res = await GET(req())
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.disk).toMatchObject({ ok: false, writable: false, freeBytes: null })
  })

  it("un statfs que falla (volumen desaparecido) degrada sin exponer el error", async () => {
    withSession()
    mocks.mkdir.mockRejectedValue(Object.assign(new Error("EROFS"), { code: "EROFS" }))
    const res = await GET(req())
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.disk).toMatchObject({ ok: false, writable: false, freeBytes: null })
    expect(JSON.stringify(body)).not.toContain("EROFS")
  })

  it("el disco degradado junto a la BD caída se reporta con schema unavailable", async () => {
    withSession()
    mocks.statfs.mockResolvedValue({ bavail: 1, bsize: 4096 })
    mocks.transaction.mockRejectedValue(new Error("down"))
    const res = await GET(req())
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.schema).toBe("unavailable")
    expect(body.disk.ok).toBe(false)
  })
})

describe("GET /api/health — rama profunda con ?deep + CRON_SECRET", () => {
  it("x-cron-secret válido habilita el chequeo profundo sin sesión", async () => {
    const res = await GET(req("https://app.invalid/api/health?deep=1", { "x-cron-secret": "test-cron-secret" }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.schema).toBe("ready")
    expect(body.disk.ok).toBe(true)
    expect(mocks.transaction).toHaveBeenCalled()
    expect(mocks.statfs).toHaveBeenCalled()
  })

  it("Authorization: Bearer también habilita el chequeo profundo", async () => {
    const res = await GET(req("https://app.invalid/api/health?deep=true", { authorization: "Bearer test-cron-secret" }))
    expect(res.status).toBe(200)
    expect(mocks.transaction).toHaveBeenCalled()
  })

  it("sin CRON_SECRET configurado el secreto del request no sirve de nada", async () => {
    vi.stubEnv("CRON_SECRET", "")
    const res = await GET(req("https://app.invalid/api/health?deep=1", { "x-cron-secret": "test-cron-secret" }))
    expect(res.status).toBe(200)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
