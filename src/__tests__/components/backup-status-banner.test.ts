import { describe, it, expect } from "vitest"
import {
  backupBannerView,
  formatBackupAge,
  parseBackupStatus,
  type BackupStatusResponse,
  type RestoreDrillInfo,
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

/** Resumen del simulacro semanal tal como lo sirve la API. */
const drill = (over: Partial<RestoreDrillInfo> = {}): RestoreDrillInfo => ({
  configured: true,
  ok: true,
  stale: false,
  finishedAt: "2026-01-05T04:00:00.000Z",
  ageHours: 50,
  tocEntries: 214,
  error: null,
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

  it("fresco sin simulacro -> drillLabel null (payload viejo de la API)", () => {
    const view = backupBannerView(status())
    expect(view.kind).toBe("fresh")
    if (view.kind === "fresh") expect(view.drillLabel).toBeNull()
  })

  it("fresco con simulacro OK -> 'simulacro OK hace X' en la línea verde", () => {
    const view = backupBannerView(status({ restoreDrill: drill() }))
    expect(view.kind).toBe("fresh")
    if (view.kind === "fresh") {
      expect(view.drillLabel).toBe("simulacro OK hace 2 días")
      expect(view.drillHint).toContain("Último simulacro")
    }
  })

  it("simulacro stale (>192 h) -> 'simulacro pendiente' sin cambiar el puntito verde", () => {
    const view = backupBannerView(status({ restoreDrill: drill({ stale: true, ageHours: 240 }) }))
    expect(view.kind).toBe("fresh")
    if (view.kind === "fresh") {
      expect(view.drillLabel).toBe("simulacro pendiente")
      expect(view.drillHint).toContain("8 días")
    }
  })

  it("simulacro aún no configurado -> 'simulacro pendiente'", () => {
    const view = backupBannerView(
      status({ restoreDrill: drill({ configured: false, ok: false, stale: true, finishedAt: null, ageHours: null }) }),
    )
    expect(view.kind).toBe("fresh")
    if (view.kind === "fresh") expect(view.drillLabel).toBe("simulacro pendiente")
  })

  it("simulacro fallido -> 'simulacro falló' sin romper la vista fresh del backup", () => {
    const view = backupBannerView(
      status({ restoreDrill: drill({ ok: false, error: "pg_restore fallo: <path>" }) }),
    )
    expect(view.kind).toBe("fresh")
    if (view.kind === "fresh") {
      expect(view.drillLabel).toBe("simulacro falló")
      expect(view.drillHint).toContain("<path>")
    }
  })

  it("backup stale -> el drill se ignora (el foco es el backup diario)", () => {
    const view = backupBannerView(status({ stale: true, ageHours: 72, restoreDrill: drill() }))
    expect(view.kind).toBe("stale")
    expect("drillLabel" in view).toBe(false)
  })

  it("backup fallido -> failed aunque el simulacro esté sano", () => {
    const view = backupBannerView(status({ ok: false, restoreDrill: drill() }))
    expect(view.kind).toBe("failed")
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

  it("parsea restoreDrill cuando viene en la respuesta", () => {
    const parsed = parseBackupStatus({ ...status(), restoreDrill: drill() })
    expect(parsed?.restoreDrill).toMatchObject({
      configured: true,
      ok: true,
      stale: false,
      ageHours: 50,
      tocEntries: 214,
      finishedAt: "2026-01-05T04:00:00.000Z",
    })
  })

  it("tolera la ausencia de restoreDrill -> undefined, no rompe", () => {
    const parsed = parseBackupStatus(status())
    expect(parsed).not.toBeNull()
    expect(parsed!.restoreDrill).toBeUndefined()
  })

  it("restoreDrill malformado (no objeto) -> undefined sin romper el parseo", () => {
    for (const bad of ["ayer", 42, [1, 2], null]) {
      const parsed = parseBackupStatus({ ...status(), restoreDrill: bad })
      expect(parsed).not.toBeNull()
      expect(parsed!.restoreDrill).toBeUndefined()
    }
  })

  it("restoreDrill parcial -> campos con defaults seguros", () => {
    const parsed = parseBackupStatus({
      ...status(),
      restoreDrill: { ok: false, error: 7, ageHours: "viejo" },
    })
    expect(parsed?.restoreDrill).toMatchObject({
      configured: false,
      ok: false,
      stale: false,
      finishedAt: null,
      ageHours: null,
      error: null,
    })
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
