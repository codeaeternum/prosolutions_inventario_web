import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * GET /api/admin/backup-status — lee el .backup-status.json que
 * scripts/backup-n5.ps1 copia dentro del volumen prosolutions_payment_proofs.
 * fs.readFile y la sesión quedan mockeadas; el endpoint nunca debe fallar
 * por el archivo (monitorización): falta/ilegible -> configured:false.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  readFile: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return { ...actual, promises: { ...actual.promises, readFile: mocks.readFile } }
})

import { GET } from "@/app/api/admin/backup-status/route"

const session = (role = "ADMIN") => ({ user: { id: "u-1", role, status: "APPROVED", businessId: "biz-1" } })

const HOUR = 3_600_000

/** Replica el shape que escribe backup-n5.ps1 (con rutas absolutas del host). */
const statusFile = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    startedAt: new Date(Date.now() - HOUR).toISOString(),
    finishedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    host: "N5",
    backupRoot: "D:\\Backups\\prosolutions",
    ok: true,
    db: { file: "D:\\Backups\\prosolutions\\db\\20260101-0300.pgdump", bytes: 4096, ok: true, error: null },
    uploads: { file: "D:\\Backups\\prosolutions\\uploads\\uploads-20260101-0300.tar.gz", bytes: 2048, ok: true, error: null },
    proofs: { file: "D:\\Backups\\prosolutions\\payment-proofs\\payment-proofs-20260101-0300.tar.gz", bytes: 512, ok: true, error: null },
    evidence: { file: "D:\\Backups\\prosolutions\\repair-evidence\\repair-evidence-20260101-0300.tar.gz", bytes: 256, ok: true, error: null },
    ...overrides,
  })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(session())
  mocks.readFile.mockResolvedValue(statusFile())
})

describe("GET /api/admin/backup-status", () => {
  it("status fresco y válido -> configured:true, stale:false, artefactos sin rutas", async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.configured).toBe(true)
    expect(body.ok).toBe(true)
    expect(body.stale).toBe(false)
    expect(body.ageHours).toBeLessThan(1)
    expect(body.startedAt).toBeTruthy()
    expect(body.finishedAt).toBeTruthy()
    expect(body.artifacts).toMatchObject({
      db: { ok: true, bytes: 4096 },
      uploads: { ok: true, bytes: 2048 },
      proofs: { ok: true, bytes: 512 },
      evidence: { ok: true, bytes: 256 },
    })
    // No se filtran rutas absolutas del host ni campos internos del archivo.
    const raw = JSON.stringify(body)
    expect(raw).not.toContain("D:\\")
    expect(raw).not.toContain("backupRoot")
    expect(raw).not.toContain(".pgdump")
    expect(raw).not.toContain(".tar.gz")
  })

  it("backup de hace 3 días -> stale:true con ageHours > 48", async () => {
    const old = new Date(Date.now() - 72 * HOUR).toISOString()
    mocks.readFile.mockResolvedValue(statusFile({ startedAt: old, finishedAt: old }))
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.configured).toBe(true)
    expect(body.stale).toBe(true)
    expect(body.ageHours).toBeGreaterThan(48)
  })

  it("archivo ausente -> configured:false, stale:true (sin error HTTP)", async () => {
    mocks.readFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ configured: false, ok: false, stale: true })
  })

  it("JSON ilegible -> configured:false, stale:true (sin error HTTP)", async () => {
    mocks.readFile.mockResolvedValue("{ not json")
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ configured: false, stale: true })
  })

  it("no admin -> 403 y ni siquiera se lee el archivo", async () => {
    mocks.auth.mockResolvedValue(session("EMPLOYEE"))
    const res = await GET()
    expect(res.status).toBe(403)
    expect(mocks.readFile).not.toHaveBeenCalled()
  })
})
