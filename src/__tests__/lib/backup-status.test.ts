import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * readRestoreDrill / readBackupStatus — lectura de los JSON que los scripts
 * del host (N5) copian dentro del volumen prosolutions_payment_proofs:
 * .backup-status.json (backup diario) y .restore-drill.json (simulacro
 * semanal de verify-backup-restore.ps1). fs.readFile queda mockeado; los
 * lectores nunca deben lanzar — archivo ausente/ilegible -> configured:false.
 */

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
}))

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return { ...actual, promises: { ...actual.promises, readFile: mocks.readFile } }
})

import { readRestoreDrill } from "@/lib/backup-status"

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** Replica el shape real que escribe verify-backup-restore.ps1. */
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
    tables: { Business: 3, WorkshopBranch: 5, User: 12, Sale: 500, RepairOrder: 120 },
    error: null,
    durationSec: 240,
    finishedAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe("readRestoreDrill", () => {
  it("archivo ausente -> configured:false, stale:true (nunca lanza)", async () => {
    mocks.readFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
    const drill = await readRestoreDrill()
    expect(drill).toMatchObject({
      configured: false,
      ok: false,
      finishedAt: null,
      ageHours: null,
      stale: true,
      tocEntries: null,
    })
    expect(drill.raw).toBeUndefined()
  })

  it("JSON ilegible -> configured:false, stale:true", async () => {
    mocks.readFile.mockResolvedValue("{ not json")
    const drill = await readRestoreDrill()
    expect(drill).toMatchObject({ configured: false, stale: true })
  })

  it("JSON que no es objeto -> configured:false", async () => {
    mocks.readFile.mockResolvedValue("[1,2,3]")
    const drill = await readRestoreDrill()
    expect(drill).toMatchObject({ configured: false, stale: true })
  })

  it("simulacro reciente y exitoso -> configured:true, stale:false, tocEntries", async () => {
    mocks.readFile.mockResolvedValue(drillFile())
    const drill = await readRestoreDrill()
    expect(drill.configured).toBe(true)
    expect(drill.ok).toBe(true)
    expect(drill.stale).toBe(false)
    expect(drill.finishedAt).toBeTruthy()
    expect(drill.ageHours).not.toBeNull()
    expect(drill.ageHours!).toBeLessThan(1)
    expect(drill.tocEntries).toBe(214)
  })

  it("tolera el BOM que deja Set-Content -Encoding UTF8", async () => {
    mocks.readFile.mockResolvedValue("\uFEFF" + drillFile())
    const drill = await readRestoreDrill()
    expect(drill.configured).toBe(true)
    expect(drill.ok).toBe(true)
  })

  it("simulacro de hace 5 días -> todavía fresco (umbral 192 h)", async () => {
    const old = new Date(Date.now() - 5 * DAY).toISOString()
    mocks.readFile.mockResolvedValue(drillFile({ startedAt: old, finishedAt: old }))
    const drill = await readRestoreDrill()
    expect(drill.stale).toBe(false)
    expect(drill.ageHours!).toBeGreaterThan(48)
    expect(drill.ageHours!).toBeLessThanOrEqual(192)
  })

  it("simulacro de hace 9 días -> stale:true con ageHours > 192", async () => {
    const old = new Date(Date.now() - 9 * DAY).toISOString()
    mocks.readFile.mockResolvedValue(drillFile({ startedAt: old, finishedAt: old }))
    const drill = await readRestoreDrill()
    expect(drill.stale).toBe(true)
    expect(drill.ageHours!).toBeGreaterThan(192)
  })

  it("simulacro fallido -> configured:true, ok:false, error en raw", async () => {
    mocks.readFile.mockResolvedValue(
      drillFile({ ok: false, error: "pg_restore fallo en D:\\Backups\\prosolutions\\db\\x.pgdump" }),
    )
    const drill = await readRestoreDrill()
    expect(drill.configured).toBe(true)
    expect(drill.ok).toBe(false)
    // El resumen no lleva error: el endpoint lo saca de raw ya sin rutas.
    expect(drill.raw?.error).toBe("pg_restore fallo en D:\\Backups\\prosolutions\\db\\x.pgdump")
    expect(drill.raw?.backupRoot).toBe("D:\\Backups\\prosolutions")
  })

  it("sin finishedAt -> ageHours null y stale:true (la edad solo se mide al terminar)", async () => {
    mocks.readFile.mockResolvedValue(drillFile({ finishedAt: null }))
    const drill = await readRestoreDrill()
    expect(drill.configured).toBe(true)
    expect(drill.finishedAt).toBeNull()
    expect(drill.ageHours).toBeNull()
    expect(drill.stale).toBe(true)
  })

  it("tocEntries no numérico -> null, sin romper el resto", async () => {
    mocks.readFile.mockResolvedValue(drillFile({ tocEntries: "muchos" }))
    const drill = await readRestoreDrill()
    expect(drill.configured).toBe(true)
    expect(drill.tocEntries).toBeNull()
  })
})
