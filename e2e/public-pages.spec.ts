import { test, expect } from "@playwright/test"
import {
  attachConsoleErrors,
  expectCleanPage,
  nonEmptyAlert,
  watchPage,
} from "./helpers"

/**
 * Smoke de páginas públicas — SOLO LECTURA, corre contra cualquier deploy
 * (incluido https://reficio.app). Ningún spec de este archivo envía
 * mutaciones: solo GET, render, validación client-side y un POST de
 * CONSULTA a /api/auth/password-reset/request (cubierto en auth-flow).
 *
 * Cada página verifica:
 *  - HTTP 200 (o la redirección amable esperada, p. ej. /verificar/<qr>).
 *  - Landmarks/controles reales del componente (leídos de src/app/**).
 *  - Sin excepciones JS no capturadas ni errores de hidratación.
 *  - Sin artefactos de serialización en el texto visible
 *    ("[object Object]", "undefined", "NaN").
 *
 * Los selectores evitan depender del viewport: el mismo spec corre en
 * "chromium" (desktop) y "mobile-chrome" (Pixel 7).
 */

test.describe("páginas públicas — smoke", () => {
  test("/ (landing): header + main + h1 + CTAs", async ({ page }, testInfo) => {
    const watch = watchPage(page)
    const response = await page.goto("/")
    expect(response?.ok(), "la landing responde 200").toBeTruthy()
    await page.waitForLoadState("load")

    await expect(page.locator("header").first()).toBeVisible()
    await expect(page.locator("main#main-content")).toBeVisible()
    // Marca + propuesta de valor (src/app/page.tsx).
    await expect(page.getByRole("link", { name: "Reficio" }).first()).toBeVisible()
    await expect(
      page.getByRole("heading", { level: 1 }),
    ).toContainText("taller")
    // La nav "Secciones" existe en el DOM aunque en móvil queda oculta
    // (hidden md:flex) — por eso se verifica presencia, no visibilidad.
    await expect(page.locator('nav[aria-label="Secciones"]')).toHaveCount(1)
    // CTAs de entrada: login y alta de negocio.
    await expect(
      page.getByRole("link", { name: "Iniciar sesión" }).first(),
    ).toHaveAttribute("href", "/login")
    await expect(
      page.getByRole("link", { name: "Crear mi negocio gratis", exact: true }).first(),
    ).toHaveAttribute("href", "/registro")

    const heroCta = page.locator('section[aria-labelledby="hero-title"]').getByRole("link", {
      name: "Crear mi negocio gratis", exact: true,
    })
    await expect(heroCta).toBeVisible()
    const viewport = page.viewportSize()
    if (viewport && viewport.width < 640) {
      const bounds = await heroCta.boundingBox()
      expect(bounds, "el CTA principal tiene dimensiones").not.toBeNull()
      expect(bounds!.y + bounds!.height, "el CTA del hero cabe en el primer viewport móvil").toBeLessThanOrEqual(viewport.height)
      await expect(page.locator("header").getByRole("link", { name: "Iniciar sesión" })).toBeHidden()
    }
    await expect(page.locator("#flujo ol > li")).toHaveCount(7)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
    await expect(page.locator("#faq details")).toHaveCount(7)
    const freeQuestion = page.locator("#faq details").filter({ hasText: "¿Es gratis de verdad?" })
    await freeQuestion.locator("summary").click()
    await expect(freeQuestion.locator("p")).toBeVisible()
    await expect(freeQuestion.locator("p")).toContainText("$0")
    await expect(page.getByRole("link", { name: "Ver una vitrina real", exact: true }).first()).toHaveAttribute("href", /^\/(?!registro)/)

    await expectCleanPage(page, watch)
    await attachConsoleErrors(page, watch, testInfo)
  })

  test("/login: formulario completo + link a /recuperar", async ({ page }, testInfo) => {
    const watch = watchPage(page)
    const response = await page.goto("/login")
    expect(response?.ok()).toBeTruthy()
    await page.waitForLoadState("load")

    await expect(page.locator("main#main-content")).toBeVisible()
    // CardTitle es un div (no heading): se aserta por texto exacto para no
    // chocar con el botón "Iniciar Sesión" (distinta capitalización).
    await expect(
      page.getByText("Iniciar sesión", { exact: true }),
    ).toBeVisible()
    // Toggle correo/teléfono y campos por defecto (método email).
    await expect(page.getByRole("button", { name: "Correo" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Teléfono" })).toBeVisible()
    await expect(page.locator("#email")).toBeVisible()
    await expect(page.locator("#password")).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Iniciar Sesión" }),
    ).toBeVisible()
    await expect(
      page.getByRole("link", { name: "¿Olvidaste tu contraseña?" }),
    ).toHaveAttribute("href", "/recuperar")

    await expectCleanPage(page, watch)
    await attachConsoleErrors(page, watch, testInfo)
  })

  test("/catalogo: grid de productos o estado vacío/error coherente", async ({
    page,
  }, testInfo) => {
    const watch = watchPage(page)
    const response = await page.goto("/catalogo")
    expect(response?.ok()).toBeTruthy()
    await page.waitForLoadState("load")

    await expect(page.locator("main#main-content")).toBeVisible()

    // La página espera a useSession antes de renderizar (CatalogoFallback
    // skeleton). El estado final es uno de tres: tarjetas de producto,
    // "No se encontraron productos" o alerta de error con Reintentar.
    const productCards = page.getByRole("button", { name: /Ver detalles de / })
    const emptyState = page.getByText("No se encontraron productos")
    const errorState = nonEmptyAlert(page).filter({
      hasText: "No se pudo cargar el catálogo",
    })
    await expect(
      productCards.first().or(emptyState).or(errorState),
    ).toBeVisible({ timeout: 30_000 })

    // El contador "N producto(s)" acompaña cualquier estado no-error.
    if (await errorState.count() === 0) {
      await expect(page.getByText(/\d+ producto/)).toBeVisible()
    }

    // Controles estables del header: búsqueda y carrito. Hay DOS inputs de
    // búsqueda (desktop `hidden md:flex` y móvil `md:hidden`): se aserta
    // sobre el visible según el viewport del proyecto.
    await expect(
      page.getByRole("link", { name: /Carrito/ }).first(),
    ).toBeVisible()
    await expect(
      page.getByLabel(/Buscar productos/).filter({ visible: true }).first(),
    ).toBeVisible()

    await expectCleanPage(page, watch)
    await attachConsoleErrors(page, watch, testInfo)
  })

  test("/seguimiento: formulario de folio; folio inexistente → error amable", async ({
    page,
  }, testInfo) => {
    const watch = watchPage(page)
    const response = await page.goto("/seguimiento")
    expect(response?.ok()).toBeTruthy()
    await page.waitForLoadState("load")

    await expect(page.locator("main#main-content")).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "Rastrea tu reparación" }),
    ).toBeVisible()

    // El submit exige folio + 4 dígitos (canSubmit en TrackOrder).
    await expect(page.locator("#folio")).toBeVisible()
    await expect(page.locator("#phone")).toBeVisible()
    await page.locator("#folio").fill("OT-999999")
    await page.locator("#phone").fill("0000")
    await page.getByRole("button", { name: "Consultar" }).click()

    // La API responde 404 genérico (anti-enumeración) → estado "notfound";
    // si el rate limit pega, el estado "error" con Reintentar también es
    // un desenlace coherente. Lo que no puede pasar: crash o pantalla blanca.
    const notFound = page.getByRole("heading", {
      name: "No encontramos una orden con esos datos",
    })
    const errorAlert = nonEmptyAlert(page)
    await expect(notFound.or(errorAlert)).toBeVisible({ timeout: 30_000 })

    await expectCleanPage(page, watch)
    await attachConsoleErrors(page, watch, testInfo)
  })

  test("/registro: alta pública — formulario o aviso de registro cerrado", async ({
    page,
  }, testInfo) => {
    const watch = watchPage(page)
    const response = await page.goto("/registro")
    expect(response?.ok()).toBeTruthy()
    await page.waitForLoadState("load")

    await expect(page.locator("main#main-content")).toBeVisible()

    // El alta depende de REFICIO_SIGNUP_ENABLED en el servidor: abierta hay
    // formulario (#businessName…); cerrada se muestra el aviso con lock.
    const signupForm = page.locator("#businessName")
    const closedNotice = page.getByText("El registro aún no está abierto")
    await expect(signupForm.or(closedNotice)).toBeVisible()

    await expectCleanPage(page, watch)
    await attachConsoleErrors(page, watch, testInfo)
  })

  test("/mercado: directorio público de negocios", async ({ page }, testInfo) => {
    const watch = watchPage(page)
    const response = await page.goto("/mercado")
    expect(response?.ok()).toBeTruthy()
    await page.waitForLoadState("load")

    await expect(page.locator("main#main-content")).toBeVisible()
    await expect(
      page.getByRole("heading", { level: 1 }),
    ).toContainText("talleres")

    await expectCleanPage(page, watch)
    await attachConsoleErrors(page, watch, testInfo)
  })

  test("/recuperar: solicitud de código — formulario neutro", async ({ page }, testInfo) => {
    const watch = watchPage(page)
    const response = await page.goto("/recuperar")
    expect(response?.ok()).toBeTruthy()
    await page.waitForLoadState("load")

    // CardTitle es un div (no heading) en los componentes ui/card.
    await expect(
      page.getByText("Recuperar contraseña", { exact: true }),
    ).toBeVisible()
    await expect(page.locator("#identifier")).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Enviar código" }),
    ).toBeVisible()
    await expect(
      page.getByRole("link", { name: "← Volver a iniciar sesión" }),
    ).toHaveAttribute("href", "/login")

    await expectCleanPage(page, watch)
    await attachConsoleErrors(page, watch, testInfo)
  })

  test("/verificar: verificación de contacto — formulario con código", async ({
    page,
  }, testInfo) => {
    const watch = watchPage(page)
    const response = await page.goto("/verificar")
    expect(response?.ok()).toBeTruthy()
    await page.waitForLoadState("load")

    await expect(page.locator("main#main-content")).toBeVisible()
    await expect(page.locator("#identifier")).toBeVisible()
    await expect(page.locator("#code")).toBeVisible()

    await expectCleanPage(page, watch)
    await attachConsoleErrors(page, watch, testInfo)
  })

  test("/verificar/<qr basura>: redirige a login o error amable — nunca 500", async ({
    page,
  }, testInfo) => {
    const watch = watchPage(page)
    // Sin sesión la página emite redirect a /login?callbackUrl=/verificar/<c>
    // (stream como meta refresh + navegación client-side, no 307 HTTP).
    const response = await page.goto("/verificar/qr-basura-e2e-000000")
    expect(
      response?.status(),
      "la ruta responde sin 5xx (redirect client-side o card de error)",
    ).toBeLessThan(500)

    // Desenlaces legítimos: aterrizar en /login (anónimo) o la card
    // "Reserva no encontrada" (staff con reserva inexistente).
    await expect
      .poll(
        async () => {
          if (page.url().includes("/login")) return "login"
          if ((await page.getByText("Reserva no encontrada").count()) > 0)
            return "notfound"
          return "pending"
        },
        { timeout: 20_000, message: "esperando redirect a login o card de error" },
      )
      .not.toBe("pending")

    if (page.url().includes("/login")) {
      await expect(page.locator("#email")).toBeVisible()
    }

    await expectCleanPage(page, watch)
    await attachConsoleErrors(page, watch, testInfo)
  })
})
