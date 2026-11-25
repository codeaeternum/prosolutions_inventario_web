import { describe, expect, it, vi } from "vitest"
import { resolveSeedPassword } from "@/lib/seed-passwords"

/**
 * S2 — el seed ya no tiene contraseña por defecto: crear una cuenta sin la
 * env explícita FALLA; si la cuenta ya existe, la env puede omitirse con un
 * warning y la contraseña previa se conserva (el upsert no la toca).
 */
describe("resolveSeedPassword", () => {
  it("devuelve la contraseña de la env cuando está definida (cuenta nueva o existente)", () => {
    const warn = vi.fn()
    expect(resolveSeedPassword("s3cret-largo", "ADMIN_PASSWORD", "a@b.mx", false, warn)).toBe("s3cret-largo")
    expect(resolveSeedPassword("s3cret-largo", "ADMIN_PASSWORD", "a@b.mx", true, warn)).toBe("s3cret-largo")
    expect(warn).not.toHaveBeenCalled()
  })

  it("recorta espacios accidentales de la env", () => {
    expect(resolveSeedPassword("  clave-con-espacios  ", "ADMIN_PASSWORD", "a@b.mx", false, vi.fn())).toBe("clave-con-espacios")
  })

  it("sin env y cuenta inexistente LANZA — no hay fallback admin123", () => {
    expect(() => resolveSeedPassword(undefined, "ADMIN_PASSWORD", "admin@prosolutions.com", false, vi.fn())).toThrow(/ADMIN_PASSWORD/)
    expect(() => resolveSeedPassword("", "SUPERADMIN_PASSWORD", "admin@reficio.app", false, vi.fn())).toThrow(/SUPERADMIN_PASSWORD/)
    // Espacios solos cuentan como vacío.
    expect(() => resolveSeedPassword("   ", "ADMIN_PASSWORD", "a@b.mx", false, vi.fn())).toThrow(/ADMIN_PASSWORD/)
  })

  it("sin env pero con cuenta existente devuelve null y avisa (skip seguro)", () => {
    const warn = vi.fn()
    expect(resolveSeedPassword(undefined, "ADMIN_PASSWORD", "admin@prosolutions.com", true, warn)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain("ADMIN_PASSWORD")
    expect(warn.mock.calls[0][0]).toContain("admin@prosolutions.com")
  })

  it("el error explica que no hay contraseña por defecto y cómo corregirlo", () => {
    expect(() => resolveSeedPassword(undefined, "ADMIN_PASSWORD", "a@b.mx", false, vi.fn())).toThrow(/contraseña por defecto/)
  })
})
