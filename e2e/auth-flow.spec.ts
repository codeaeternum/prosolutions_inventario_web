import { test, expect } from "@playwright/test"
import {
  attachConsoleErrors,
  expectCleanPage,
  nonEmptyAlert,
  watchPage,
} from "./helpers"

/**
 * Flujos de autenticación — SOLO LECTURA / sin cambios de estado.
 *
 * Cubre las reglas del gate de acceso (src/lib/auth.config.ts +
 * src/proxy.ts) y los formularios de auth, sin crear sesiones ni datos:
 *
 *  - Login con credenciales inválidas → error inline, sin redirect.
 *  - /admin sin sesión → redirect a /login (regla 2 de getAuthRedirect).
 *  - Rutas legacy (/carrito, /mis-reservas, /perfil) sin sesión →
 *    /?redirect=bot (regla 1: links viejos del bot de Telegram).
 *  - /recuperar con cualquier identificador → respuesta uniforme
 *    anti-enumeración ("Si la cuenta existe…"); el timing floor vive en el
 *    servidor, aquí se verifica que el UI no delata existencia.
 *
 * El único POST que sale de estos specs es la SOLICITUD de código de
 * reset: es una consulta acotada por rate-limit server-side, no persiste
 * datos de negocio. Seguro contra producción.
 */

test.describe("auth — credenciales inválidas", () => {
  test("login inválido muestra error y NO navega al panel", async ({
    page,
  }, testInfo) => {
    const watch = watchPage(page)
    await page.goto("/login")
    await page.locator("#email").fill("e2e-no-existe@reficio.app")
    await page.locator("#password").fill("password-equivocado-123")

    const [response] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes("/api/auth/") &&
          res.request().method() === "POST",
        { timeout: 30_000 },
      ),
      page.getByRole("button", { name: "Iniciar Sesión" }).click(),
    ])
    // NextAuth responde el intento; el resultado es error, nunca 5xx limpio.
    expect(response.status()).toBeLessThan(500)

    // Mensaje inline en role=alert (mapeo CredentialsSignin del form).
    // nonEmptyAlert filtra el #__next-route-announcer__ vacío de Next.
    const alert = nonEmptyAlert(page)
    await expect(alert).toBeVisible()
    await expect(alert).toContainText(/incorrectos|No se pudo/i)

    // Sigue en /login: nada de /admin, /post-login ni /catalogo.
    await expect(page).toHaveURL(/\/login/)
    await expect(page.locator("#email")).toBeVisible()

    await attachConsoleErrors(page, watch, testInfo)
    expect(watch.pageErrors).toEqual([])
  })
})

test.describe("auth — gate de rutas sin sesión", () => {
  // Regla 2 de getAuthRedirect: /admin exige sesión.
  for (const path of ["/admin", "/admin/ventas", "/admin/reportes"]) {
    test(`${path} sin sesión redirige a /login`, async ({ page }) => {
      await page.goto(path)
      await page.waitForURL(/\/login/, { timeout: 20_000 })
      await expect(page.locator("#email")).toBeVisible()
    })
  }

  // Regla 1: rutas legacy (links viejos del bot) sin login → /?redirect=bot.
  for (const path of ["/carrito", "/mis-reservas", "/perfil"]) {
    test(`${path} sin sesión redirige a /?redirect=bot`, async ({ page }) => {
      const response = await page.goto(path)
      // La cadena de redirects termina en la landing (200).
      expect(response?.ok()).toBeTruthy()
      await expect(page).toHaveURL(/redirect=bot/)
    })
  }
})

test.describe("auth — recuperar contraseña", () => {
  test("la solicitud de código responde uniforme (anti-enumeración)", async ({
    page,
  }, testInfo) => {
    const watch = watchPage(page)
    await page.goto("/recuperar")
    await page
      .locator("#identifier")
      .fill("e2e-sondeo-no-existe@reficio.app")

    const [response] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/auth/password-reset/request"),
        { timeout: 30_000 },
      ),
      page.getByRole("button", { name: "Enviar código" }).click(),
    ])

    // El servidor siempre contesta 200 + mensaje uniforme (o 429 si el
    // bucket de rate-limit está gastado). Lo que NO puede hacer es
    // responder "la cuenta no existe" ni 5xx.
    expect(response.status()).toBeLessThan(500)
    if (response.ok()) {
      const body = (await response.json().catch(() => null)) as {
        message?: string
      } | null
      expect(body?.message ?? "").toMatch(/Si la cuenta existe/i)
      // El UI avanza al paso "confirm" mostrando el mismo mensaje neutro:
      // ni confirma ni niega que el correo esté registrado.
      await expect(
        page.getByRole("status").filter({ hasText: "Si la cuenta existe" }),
      ).toBeVisible()
      await expect(page.locator("#code")).toBeVisible()
    } else {
      // 429 u otro error controlado: el UI lo muestra como alerta genérica.
      await expect(nonEmptyAlert(page)).toBeVisible()
    }
    // En ningún desenlace el UI delata existencia de la cuenta.
    await expect(
      page.getByText(/no existe|no está registrad|no encontramos la cuenta/i),
    ).toHaveCount(0)

    await attachConsoleErrors(page, watch, testInfo)
    expect(watch.pageErrors).toEqual([])
    await expectCleanPage(page, watch)
  })
})
