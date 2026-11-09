import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * GET /api/health — readiness de la app.
 *
 * El endpoint valida dos cosas y reporta ambas en el cuerpo:
 *   - schema: las 10 consultas LIMIT 0 + la tabla _prisma_migrations sin
 *     migraciones fallidas (ready | migration_failed | unavailable).
 *   - disk: el directorio de comprobantes (PAYMENT_PROOFS_DIR) debe existir,
 *     ser escribible y tener >=500 MB libres — es el mismo path que usa
 *     writePaymentProof, así un disco lleno o un volumen sin permisos se
 *     detecta ANTES de que fallen las subidas.
 * Un disco degradado responde 503 aunque el schema esté listo.
 */

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  mkdir: vi.fn(),
  statfs: vi.fn(),
  access: vi.fn(),
}))

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

beforeEach(() => {
  vi.clearAllMocks()
  mocks.transaction.mockResolvedValue([[]]) // _prisma_migrations sin fallos
  mocks.mkdir.mockResolvedValue(undefined)
  mocks.statfs.mockResolvedValue(PLENTY)
  mocks.access.mockResolvedValue(undefined)
})

describe("GET /api/health", () => {
  it("responde 200 con schema ready y métricas de disco cuando todo está sano", async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("ok")
    expect(body.ok).toBe(true)
    expect(body.schema).toBe("ready")
    expect(body.disk).toMatchObject({
      ok: true,
      writable: true,
      freeBytes: PLENTY.bavail * PLENTY.bsize,
      minFreeBytes: MIN_FREE,
    })
    // El path del volumen no se expone en un endpoint público.
    expect(JSON.stringify(body)).not.toContain("payment-proofs")
    expect(mocks.statfs).toHaveBeenCalledWith("/app/storage/payment-proofs")
    expect(mocks.access).toHaveBeenCalledWith("/app/storage/payment-proofs", 2) // W_OK
  })

  it("una migración fallida sigue respondiendo 503 migration_failed (e incluye el disco)", async () => {
    mocks.transaction.mockResolvedValue([[{ migration_name: "20250101000000_stuck" }]])
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.status).toBe("degraded")
    expect(body.schema).toBe("migration_failed")
    expect(body.disk.ok).toBe(true)
  })

  it("la BD caída responde 503 schema unavailable", async () => {
    mocks.transaction.mockRejectedValue(new Error("connection refused"))
    const res = await GET()
    expect(res.status).toBe(503)
    expect((await res.json()).schema).toBe("unavailable")
  })

  it("menos de 500 MB libres degrada a 503 aunque el schema esté listo", async () => {
    mocks.statfs.mockResolvedValue({ bavail: Math.floor((100 * 1024 * 1024) / 4096), bsize: 4096 })
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.status).toBe("degraded")
    expect(body.schema).toBe("ready")
    expect(body.disk).toMatchObject({ ok: false, writable: true })
    expect(body.disk.freeBytes).toBeLessThan(MIN_FREE)
  })

  it("un directorio no escribible (access W_OK falla) degrada a 503", async () => {
    mocks.access.mockRejectedValue(Object.assign(new Error("EACCES"), { code: "EACCES" }))
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.disk).toMatchObject({ ok: false, writable: false, freeBytes: null })
  })

  it("un statfs que falla (volumen desaparecido) degrada sin exponer el error", async () => {
    mocks.mkdir.mockRejectedValue(Object.assign(new Error("EROFS"), { code: "EROFS" }))
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.disk).toMatchObject({ ok: false, writable: false, freeBytes: null })
    expect(JSON.stringify(body)).not.toContain("EROFS")
  })

  it("el disco degradado junto a la BD caída se reporta con schema unavailable", async () => {
    mocks.statfs.mockResolvedValue({ bavail: 1, bsize: 4096 })
    mocks.transaction.mockRejectedValue(new Error("down"))
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.schema).toBe("unavailable")
    expect(body.disk.ok).toBe(false)
  })
})
