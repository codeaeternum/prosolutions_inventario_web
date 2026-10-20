import { describe, it, expect } from "vitest"
import {
  backupBannerView,
  formatBackupAge,
  parseBackupStatus,
  type BackupStatusResponse,
} from "@/components/admin/backup-status-banner"

// El dashboard no puede renderizar componentes en vitest (ambiente node, sin
// DOM): se prueba la vista derivada. Regla del banner — solo estorba cuando
// hay problema: stale -> amber, último intento fallido -> rojo, fresco ->
// puntito verde discreto, error/403 -> nada.
const status = (over: Partial<BackupStatusResponse> = {}): BackupStatusResponse => ({
  configured: true,
  ok: true,
  stale: false,
  ageHours: 3.2,
  startedAt: "2026-01-01T10:00:00.000Z",
  finishedAt: "2026-01-01T10:10:00.000Z",
  artifacts: {
    db: { ok: true, bytes: 4096, error: null },
    uploads: { ok: true, bytes: 2048, error: null },
    proofs: { ok: true, bytes: 512, error: null },
    evidence: { ok: true, bytes: 256, error: null },
  },
  ...over,
})

describe("backupBannerView", () => {
  it("fresco y exitoso -> fresh (solo puntito, sin banner)", () => {
    const view = backupBannerView(status())
    expect(view.kind).toBe("fresh")
    if (view.kind === "fresh") {
      expect(view.ageLabel).toBe("hace 3 h")
      expect(view.lastRun).toBe("2026-01-01T10:10:00.000Z")
    }
  })

  it("stale (>48 h) -> banner amber con la edad del último respaldo", () => {
    const view = backupBannerView(status({ stale: true, ageHours: 72 }))
    expect(view.kind).toBe("stale")
    if (view.kind === "stale") {
      expect(view.configured).toBe(true)
      expect(view.ageLabel).toBe("hace 3 días")
      expect(view.lastFailed).toBe(false)
    }
  })

  it("sin archivo de estado -> stale no configurado (banner, no silencio)", () => {
    // Shape real del endpoint cuando falta .backup-status.json.
    const view = backupBannerView(status({ configured: false, ok: false, stale: true, ageHours: null }))
    expect(view.kind).toBe("stale")
    if (view.kind === "stale") expect(view.configured).toBe(false)
  })

  it("stale y además el último intento falló -> lo reporta el banner", () => {
    const view = backupBannerView(status({ ok: false, stale: true, ageHours: 60 }))
    expect(view.kind).toBe("stale")
    if (view.kind === "stale") expect(view.lastFailed).toBe(true)
  })

  it("reciente pero fallido -> banner rojo con las piezas que fallaron", () => {
    const view = backupBannerView(
      status({
        ok: false,
        artifacts: {
          db: { ok: false, bytes: 0, error: "pg_dump: <path>" },
          uploads: { ok: true, bytes: 2048, error: null },
          proofs: { ok: false, bytes: 0, error: "timeout" },
          evidence: { ok: true, bytes: 256, error: null },
        },
      }),
    )
    expect(view.kind).toBe("failed")
    if (view.kind === "failed") {
      expect(view.failedLabels).toEqual(["la base de datos", "los comprobantes de pago"])
    }
  })

  it("fallido sin desglose de artefactos -> failed con lista vacía", () => {
    const view = backupBannerView(status({ ok: false, artifacts: undefined }))
    expect(view.kind).toBe("failed")
    if (view.kind === "failed") expect(view.failedLabels).toEqual([])
  })
})

describe("parseBackupStatus", () => {
  it("acepta la respuesta real del endpoint (fresco y sin configurar)", () => {
    expect(parseBackupStatus(status())).toMatchObject({ configured: true, ok: true, stale: false })
    expect(parseBackupStatus({ configured: false, ok: false, ageHours: null, stale: true }))
      .toMatchObject({ configured: false, stale: true, ageHours: null })
  })

  it("descarta basura -> el banner no muestra nada (equivale a error/403)", () => {
    expect(parseBackupStatus(null)).toBeNull()
    expect(parseBackupStatus(undefined)).toBeNull()
    expect(parseBackupStatus("error")).toBeNull()
    expect(parseBackupStatus([])).toBeNull()
    expect(parseBackupStatus({ unexpected: true })).toBeNull()
    expect(parseBackupStatus({ ok: "si", stale: true })).toBeNull()
  })

  it("tolera campos extra y fechas inválidas sin romper", () => {
    const parsed = parseBackupStatus({
      configured: true,
      ok: true,
      stale: false,
      ageHours: "ayer",
      finishedAt: "no-es-fecha",
      extra: "del host",
    })
    expect(parsed).toMatchObject({ ok: true, ageHours: null, finishedAt: null })
  })
})

describe("formatBackupAge", () => {
  it("resume la edad en horas o días según la magnitud", () => {
    expect(formatBackupAge(0.4)).toBe("hace menos de 1 h")
    expect(formatBackupAge(5.9)).toBe("hace 5 h")
    expect(formatBackupAge(26)).toBe("hace 1 día")
    expect(formatBackupAge(72)).toBe("hace 3 días")
    expect(formatBackupAge(null)).toBe("")
  })
})
