import { test, expect } from "@playwright/test"
import { api, loginAdminCached } from "./pilot-helpers"

/**
 * Kiosco de asistencia (POST /api/asistencia/kiosco): checada compartida de
 * mostrador con PIN rápido. Es API-only — la tableta dedicada vive en
 * /admin/asistencia-kiosco pero el contrato crítico es el endpoint.
 *
 * Anti-enumeración (oleada 42): userId inexistente, userId ajeno/inactivo,
 * PIN sin formato y PIN incorrecto comparten el mismo 401
 * "PIN incorrecto o usuario inválido" — el status no filtra existencia.
 *
 * La imagen del pilot puede ser anterior al kiosco (oleada 37+): si el
 * endpoint no existe el spec se salta con nota.
 *
 * ESCRIBE en el servidor (rate-limit counters + ClockEvent en PINs válidos):
 * solo pilot desechable + E2E_ALLOW_WRITES=1.
 */

const adminEmail = process.env.E2E_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD

test.describe("escritura — solo ambiente desechable", () => {
  test.describe.configure({ retries: 1 })
  test.skip(
    !adminEmail || !adminPassword || process.env.E2E_ALLOW_WRITES !== "1",
    "requiere E2E_ADMIN_* y E2E_ALLOW_WRITES=1 contra un ambiente desechable (scripts/e2e-pilot.sh)",
  )

  test("kiosco rechaza userId inválido con 401 uniforme", async ({ page }) => {
    await loginAdminCached(page, adminEmail!, adminPassword!)

    const res = await api<{ error?: string; code?: string }>(page, "/api/asistencia/kiosco", {
      method: "POST",
      body: { userId: "usuario-que-no-existe-e2e", pin: "1234" },
    })
    if (res.status === 404) {
      test.skip(true, "la imagen del pilot no trae /api/asistencia/kiosco (pre-oleada 37)")
    }
    expect(res.status).toBe(401)
    expect(res.data?.error).toBe("PIN incorrecto o usuario inválido")
  })

  test("kiosco: PIN con formato inválido responde el mismo 401 (sin oráculo)", async ({ page }) => {
    await loginAdminCached(page, adminEmail!, adminPassword!)

    // Un PIN no numérico y un userId inexistente deben ser indistinguibles:
    // mismo status y mismo mensaje (anti timing/enumeration).
    const badFormat = await api<{ error?: string }>(page, "/api/asistencia/kiosco", {
      method: "POST",
      body: { userId: "usuario-que-no-existe-e2e", pin: "abc!" },
    })
    if (badFormat.status === 404) {
      test.skip(true, "la imagen del pilot no trae /api/asistencia/kiosco (pre-oleada 37)")
    }
    expect(badFormat.status).toBe(401)
    expect(badFormat.data?.error).toBe("PIN incorrecto o usuario inválido")
  })

  test("kiosco sin sesión responde 401/403/redirect (no filtra el endpoint)", async ({ page }) => {
    // Sin login: el middleware de staff responde antes del body — el
    // endpoint no debe ser usable ni enumerar nada anónimamente.
    // maxRedirects:0 para ver el status real (sin él el cliente sigue el
    // 307 a /login y devolvería 200 HTML).
    const res = await page.request.post("/api/asistencia/kiosco", {
      data: { userId: "x", pin: "1234" },
      maxRedirects: 0,
    })
    test.skip(res.status() === 404, "la imagen del pilot no trae /api/asistencia/kiosco (pre-oleada 37)")
    expect([401, 403, 307, 308]).toContain(res.status())
  })
})
