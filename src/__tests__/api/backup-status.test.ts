import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * GET /api/admin/backup-status — lee el .backup-status.json que
 * scripts/backup-n5.ps1 copia dentro del volumen prosolutions_payment_proofs
 * y el .restore-drill.json del simulacro semanal (verify-backup-restore.ps1),
 * ambos en el mismo directorio. fs.readFile queda mockeado por ruta — el
 * endpoint nunca debe fallar por los archivos (monitorización):
 * falta/ilegible -> configured:false en cada parte.
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

/** Replica el shape real que escribe verify-backup-restore.ps1 (con rutas del host). */
const drillFile = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    startedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
    host: "N5",
    backupRoot: "D:\\Backups\\prosolutions",
    dumpFile: "D:\\Backups\\prosolutions\\db\\20260101-0300.pgdump",
    dumpBytes: 4096,
    tocEntries: 214,
    container: "prosolutions-restore-drill",
    ok: true,
    tables: { Business: 3, User: 12, Sale: 500 },
    error: null,
    durationSec: 240,
    finishedAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  })

/**
 * Sirve distinto contenido según el archivo pedido: el volumen ahora tiene
 * DOS status JSON (.backup-status.json y .restore-drill.json).
 */
const serveFiles = (status: () => string | Promise<string>, drill: () => string | Promise<string>) =>
  mocks.readFile.mockImplementation((p: unknown) =>
    String(p).includes(".restore-drill") ? Promise.resolve(drill()) : Promise.resolve(status()),
  )

const enoent = () => Object.assign(new Error("ENOENT"), { code: "ENOENT" })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(session())
  serveFiles(() => statusFile(), () => drillFile())
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
    serveFiles(() => statusFile({ startedAt: old, finishedAt: old }), () => drillFile())
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.configured).toBe(true)
    expect(body.stale).toBe(true)
    expect(body.ageHours).toBeGreaterThan(48)
  })

  it("archivo ausente -> configured:false, stale:true (sin error HTTP)", async () => {
    mocks.readFile.mockRejectedValue(enoent())
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ configured: false, ok: false, stale: true })
    expect(body.restoreDrill).toMatchObject({ configured: false, stale: true })
  })

  it("JSON ilegible -> configured:false, stale:true (sin error HTTP)", async () => {
    mocks.readFile.mockResolvedValue("{ not json")
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ configured: false, stale: true })
  })

  it("expone restoreDrill: simulacro reciente -> configured:true, stale:false, tocEntries", async () => {
    const res = await GET()
    const body = await res.json()
    expect(body.restoreDrill).toMatchObject({
      configured: true,
      ok: true,
      stale: false,
      tocEntries: 214,
    })
    expect(body.restoreDrill.finishedAt).toBeTruthy()
    expect(body.restoreDrill.ageHours).toBeLessThan(1)
    // Campos internos del drill (rutas, contenedor, conteo de tablas) no salen.
    const raw = JSON.stringify(body.restoreDrill)
    expect(raw).not.toContain("D:\\")
    expect(raw).not.toContain("dumpFile")
    expect(raw).not.toContain("container")
    expect(raw).not.toContain("tables")
  })

  it("simulacro ausente -> restoreDrill configured:false sin tumbar el backup", async () => {
    mocks.readFile.mockImplementation((p: unknown) =>
      String(p).includes(".restore-drill") ? Promise.reject(enoent()) : Promise.resolve(statusFile()),
    )
    const res = await GET()
    const body = await res.json()
    expect(body.configured).toBe(true)
    expect(body.ok).toBe(true)
    expect(body.restoreDrill).toMatchObject({ configured: false, ok: false, stale: true, error: null })
  })

  it("simulacro de hace 9 días -> restoreDrill stale:true con ageHours > 192", async () => {
    const old = new Date(Date.now() - 9 * 24 * HOUR).toISOString()
    serveFiles(() => statusFile(), () => drillFile({ startedAt: old, finishedAt: old }))
    const res = await GET()
    const body = await res.json()
    expect(body.stale).toBe(false) // el backup diario sigue fresco
    expect(body.restoreDrill.stale).toBe(true)
    expect(body.restoreDrill.ageHours).toBeGreaterThan(192)
  })

  it("simulacro fallido -> ok:false y error sin rutas del host", async () => {
    serveFiles(
      () => statusFile(),
      () => drillFile({ ok: false, error: "pg_restore fallo: D:\\Backups\\prosolutions\\db\\x.pgdump en E:\\tmp\\out" }),
    )
    const res = await GET()
    const body = await res.json()
    expect(body.restoreDrill.configured).toBe(true)
    expect(body.restoreDrill.ok).toBe(false)
    expect(body.restoreDrill.error).toBeTruthy()
    expect(body.restoreDrill.error).not.toContain("D:\\")
    expect(body.restoreDrill.error).not.toContain("E:\\")
    expect(body.restoreDrill.error).not.toContain("prosolutions")
    expect(body.restoreDrill.error).toContain("<path>")
  })

  it("backup sin configurar pero con simulacro -> restoreDrill viaja igual", async () => {
    mocks.readFile.mockImplementation((p: unknown) =>
      String(p).includes(".restore-drill") ? Promise.resolve(drillFile()) : Promise.reject(enoent()),
    )
    const res = await GET()
    const body = await res.json()
    expect(body).toMatchObject({ configured: false, ok: false, stale: true })
    expect(body.restoreDrill).toMatchObject({ configured: true, ok: true, stale: false })
  })

  it("no admin -> 403 y ni siquiera se lee el archivo", async () => {
    mocks.auth.mockResolvedValue(session("EMPLOYEE"))
    const res = await GET()
    expect(res.status).toBe(403)
    expect(mocks.readFile).not.toHaveBeenCalled()
  })
})
