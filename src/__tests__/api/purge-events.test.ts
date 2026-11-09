import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Cron /api/cron/purge-events — retención de bitácoras. Solo corre con
 * CRON_SECRET válido; borra AuditEvent/PlatformEvent anteriores a los cutoffs
 * configurables por env (AUDIT_RETENTION_DAYS / PLATFORM_RETENTION_DAYS, con
 * clamp) vía deleteMany(createdAt < cutoff).
 */
const DAY_MS = 24 * 60 * 60 * 1000
const TOLERANCE_MS = 60_000

const mocks = vi.hoisted(() => {
  const auditDeleteMany = vi.fn().mockResolvedValue({ count: 3 })
  const platformDeleteMany = vi.fn().mockResolvedValue({ count: 7 })
  const notificationDeleteMany = vi.fn().mockResolvedValue({ count: 11 })
  const directoryDeleteMany = vi.fn().mockResolvedValue({ count: 19 })
  const prisma = {
    auditEvent: { deleteMany: auditDeleteMany },
    platformEvent: { deleteMany: platformDeleteMany },
    notification: { deleteMany: notificationDeleteMany },
    directoryEvent: { deleteMany: directoryDeleteMany },
  }
  return { auditDeleteMany, platformDeleteMany, notificationDeleteMany, directoryDeleteMany, prisma }
})
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))

import { GET } from "@/app/api/cron/purge-events/route"

const get = (
  headers: Record<string, string> = { authorization: "Bearer test-secret" }
) => GET(new Request("https://app.invalid/api/cron/purge-events", { headers }))

// Edad aproximada del cutoff que recibió deleteMany (con tolerancia de ejecución).
const cutoffDays = (fn: ReturnType<typeof vi.fn>) => {
  const { where } = fn.mock.calls[0][0] as { where: { createdAt: { lt: Date } } }
  return (Date.now() - where.createdAt.lt.getTime()) / DAY_MS
}

describe("cron purge-events", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    mocks.auditDeleteMany.mockResolvedValue({ count: 3 })
    mocks.platformDeleteMany.mockResolvedValue({ count: 7 })
    mocks.notificationDeleteMany.mockResolvedValue({ count: 11 })
    mocks.directoryDeleteMany.mockResolvedValue({ count: 19 })
    vi.stubEnv("CRON_SECRET", "test-secret")
  })

  it("responds 503 when CRON_SECRET is not configured and never touches the DB", async () => {
    vi.stubEnv("CRON_SECRET", "")
    const res = await get()
    expect(res.status).toBe(503)
    expect(mocks.auditDeleteMany).not.toHaveBeenCalled()
    expect(mocks.platformDeleteMany).not.toHaveBeenCalled()
    expect(mocks.notificationDeleteMany).not.toHaveBeenCalled()
    expect(mocks.directoryDeleteMany).not.toHaveBeenCalled()
  })

  it("rejects wrong or missing secrets (401) without touching the DB, and accepts x-cron-secret", async () => {
    const badHeaders: Record<string, string>[] = [
      {},
      { authorization: "Bearer wrong" },
      { "x-cron-secret": "wrong" },
    ]
    for (const headers of badHeaders) {
      const res = await get(headers)
      expect(res.status).toBe(401)
    }
    expect(mocks.auditDeleteMany).not.toHaveBeenCalled()
    expect(mocks.platformDeleteMany).not.toHaveBeenCalled()
    expect(mocks.notificationDeleteMany).not.toHaveBeenCalled()
    expect(mocks.directoryDeleteMany).not.toHaveBeenCalled()

    const ok = await get({ "x-cron-secret": "test-secret" })
    expect(ok.status).toBe(200)
  })

  it("deletes with the default cutoffs (90d audit/notification, 180d directory, 365d platform) and reports counts", async () => {
    const res = await get()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.auditDeleted).toBe(3)
    expect(body.platformDeleted).toBe(7)
    expect(body.notificationDeleted).toBe(11)
    expect(body.directoryDeleted).toBe(19)
    expect(new Date(body.auditCutoff).getTime()).toBeCloseTo(
      Date.now() - 90 * DAY_MS, -3
    )
    expect(new Date(body.platformCutoff).getTime()).toBeCloseTo(
      Date.now() - 365 * DAY_MS, -3
    )
    expect(new Date(body.notificationCutoff).getTime()).toBeCloseTo(
      Date.now() - 90 * DAY_MS, -3
    )
    expect(new Date(body.directoryCutoff).getTime()).toBeCloseTo(
      Date.now() - 180 * DAY_MS, -3
    )

    expect(mocks.auditDeleteMany).toHaveBeenCalledTimes(1)
    expect(mocks.platformDeleteMany).toHaveBeenCalledTimes(1)
    expect(mocks.notificationDeleteMany).toHaveBeenCalledTimes(1)
    expect(mocks.directoryDeleteMany).toHaveBeenCalledTimes(1)
    expect(mocks.auditDeleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) } },
    })
    expect(mocks.platformDeleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) } },
    })
    expect(mocks.notificationDeleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) } },
    })
    expect(mocks.directoryDeleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) } },
    })

    const auditDays = cutoffDays(mocks.auditDeleteMany)
    const platformDays = cutoffDays(mocks.platformDeleteMany)
    const notificationDays = cutoffDays(mocks.notificationDeleteMany)
    const directoryDays = cutoffDays(mocks.directoryDeleteMany)
    expect(auditDays).toBeGreaterThanOrEqual(90)
    expect(auditDays).toBeLessThan(90 + TOLERANCE_MS / DAY_MS)
    expect(platformDays).toBeGreaterThanOrEqual(365)
    expect(platformDays).toBeLessThan(365 + TOLERANCE_MS / DAY_MS)
    expect(notificationDays).toBeGreaterThanOrEqual(90)
    expect(notificationDays).toBeLessThan(90 + TOLERANCE_MS / DAY_MS)
    expect(directoryDays).toBeGreaterThanOrEqual(180)
    expect(directoryDays).toBeLessThan(180 + TOLERANCE_MS / DAY_MS)
  })

  it("honors AUDIT_RETENTION_DAYS / PLATFORM_RETENTION_DAYS", async () => {
    vi.stubEnv("AUDIT_RETENTION_DAYS", "45")
    vi.stubEnv("PLATFORM_RETENTION_DAYS", "120")
    const res = await get()
    expect(res.status).toBe(200)

    const auditDays = cutoffDays(mocks.auditDeleteMany)
    const platformDays = cutoffDays(mocks.platformDeleteMany)
    expect(auditDays).toBeGreaterThanOrEqual(45)
    expect(auditDays).toBeLessThan(45 + TOLERANCE_MS / DAY_MS)
    expect(platformDays).toBeGreaterThanOrEqual(120)
    expect(platformDays).toBeLessThan(120 + TOLERANCE_MS / DAY_MS)
  })

  it("clamps retention env vars to their allowed ranges", async () => {
    vi.stubEnv("AUDIT_RETENTION_DAYS", "5") // < min 30 → 30
    vi.stubEnv("PLATFORM_RETENTION_DAYS", "5000") // > max 730 → 730
    const res = await get()
    expect(res.status).toBe(200)

    const auditDays = cutoffDays(mocks.auditDeleteMany)
    const platformDays = cutoffDays(mocks.platformDeleteMany)
    expect(auditDays).toBeGreaterThanOrEqual(30)
    expect(auditDays).toBeLessThan(30 + TOLERANCE_MS / DAY_MS)
    expect(platformDays).toBeGreaterThanOrEqual(730)
    expect(platformDays).toBeLessThan(730 + TOLERANCE_MS / DAY_MS)
  })

  it("responds 500 when a delete fails", async () => {
    mocks.auditDeleteMany.mockRejectedValueOnce(new Error("db down"))
    const res = await get()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toContain("db down")
  })
})
