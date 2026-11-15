import { test, expect } from "@playwright/test"
import {
  attachConsoleErrors,
  CART_SCOPED_PREFIX,
  dumpLocalStorage,
  expectCleanPage,
  loginAsAdmin,
  watchPage,
  type CartSeedItem,
} from "./helpers"

/**
 * Smoke del panel de administración — REQUIERE SESIÓN REAL.
 *
 * Todos los specs se auto-skipean sin credenciales de ambiente, así que la
 * suite es segura de correr completa contra producción (quedan en skip):
 *
 *   E2E_ADMIN_EMAIL=admin@taller.test E2E_ADMIN_PASSWORD=*** \
 *   E2E_BASE_URL=https://reficio.app npx playwright test e2e/admin-smoke.spec.ts
 *
 * Reglas:
 *  - Los specs de este archivo solo LEEN del servidor (navegación +
 *    localStorage). Ninguno confirma ventas, reservas ni formularios que
 *    persistan.
 *  - El POS real vive en /admin/ventas (en el menú: "Vender") — no existe
 *    /admin/pos.
 *  - /admin/reportes exige rol ADMIN: un EMPLOYEE es redirigido a /admin
 *    (src/lib/auth.config.ts regla 2.2). Usa una cuenta ADMIN.
 *  - Cualquier spec futuro que escriba en el servidor (crear venta, cerrar
 *    caja, confirmar reserva) debe vivir en el describe
 *    "escritura — ambiente desechable" de abajo, gated por
 *    E2E_ALLOW_WRITES=1, y NUNCA apuntar a producción.
 */

const adminEmail = process.env.E2E_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD
const hasAdminCreds = Boolean(adminEmail && adminPassword)
const allowWrites = process.env.E2E_ALLOW_WRITES === "1"

test.describe("admin — smoke con sesión", () => {
  test.skip(
    !hasAdminCreds,
    "requiere E2E_ADMIN_EMAIL y E2E_ADMIN_PASSWORD con un usuario ADMIN aprobado en la BD del ambiente",
  )

  test("login admin → /admin renderiza dashboard + sidebar", async ({
    page,
  }, testInfo) => {
    const watch = watchPage(page)
    await loginAsAdmin(page, adminEmail!, adminPassword!)
    // post-login puede aterrizar en /admin/ventas (PARTS) o /admin/taller
    // (REPAIR) según el giro del negocio: la navegación explícita deja el
    // smoke determinista.
    await page.goto("/admin")

    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible()
    // Sidebar con la navegación operativa (drawer móvil queda inert en
    // desktop; el bottom bar es lg:hidden — .first() absorbe duplicados).
    await expect(
      page.getByRole("link", { name: "Inicio" }).first(),
    ).toBeVisible()
    await expect(
      page.getByRole("link", { name: "Vender" }).first(),
    ).toBeVisible()
    await expect(page.locator("main#main-content")).toBeVisible()

    await expectCleanPage(page, watch)
    await attachConsoleErrors(page, watch, testInfo)
  })

  test("/admin/ventas renderiza el Punto de Venta", async ({
    page,
  }, testInfo) => {
    const watch = watchPage(page)
    await loginAsAdmin(page, adminEmail!, adminPassword!)
    await page.goto("/admin/ventas")

    await expect(
      page.getByRole("heading", { name: /Punto de Venta/ }),
    ).toBeVisible({ timeout: 30_000 })

    await expectCleanPage(page, watch)
    await attachConsoleErrors(page, watch, testInfo)
  })

  test("/admin/reportes carga (rol ADMIN)", async ({ page }, testInfo) => {
    const watch = watchPage(page)
    await loginAsAdmin(page, adminEmail!, adminPassword!)
    await page.goto("/admin/reportes")

    // Si la cuenta fuera EMPLOYEE el middleware la regresa a /admin — el
    // env debe ser ADMIN para este spec.
    await expect(
      page.getByRole("heading", { name: "Reportes" }),
      "la cuenta E2E_ADMIN_* debe ser rol ADMIN (EMPLOYEE es redirigido a /admin)",
    ).toBeVisible({ timeout: 30_000 })

    await expectCleanPage(page, watch)
    await attachConsoleErrors(page, watch, testInfo)
  })

  test("/carrito con sesión: lista items y quitar funciona (solo localStorage)", async ({
    page,
  }, testInfo) => {
    const watch = watchPage(page)
    await loginAsAdmin(page, adminEmail!, adminPassword!)
    await page.goto("/admin")

    // El scope del carrito con sesión es cart:{businessId} — se obtiene de
    // la sesión viva (GET, lectura) para sembrar la clave correcta.
    const businessId = await page.evaluate(async () => {
      const res = await fetch("/api/auth/session")
      const json = (await res.json().catch(() => null)) as {
        user?: { businessId?: string }
      } | null
      return json?.user?.businessId ?? null
    })
    expect(businessId, "la sesión debe exponer user.businessId").toBeTruthy()

    const cartKey = `${CART_SCOPED_PREFIX}${businessId}`
    const seed: CartSeedItem[] = [
      {
        productId: "E2E-SESSION-ITEM-1",
        name: "Item E2E sesión uno",
        price: 100,
        quantity: 1,
        maxStock: 5,
      },
      {
        productId: "E2E-SESSION-ITEM-2",
        name: "Item E2E sesión dos",
        price: 200,
        quantity: 2,
        maxStock: 5,
      },
    ]
    // Se escribe la clave ANTES de cargar /carrito: el provider la lee al
    // hidratar en la siguiente navegación completa.
    await page.evaluate(
      ({ key, items }) => localStorage.setItem(key, JSON.stringify(items)),
      { key: cartKey, items: seed },
    )

    await page.goto("/carrito")
    await expect(
      page.getByRole("heading", { name: /Carrito \(2\)/ }),
    ).toBeVisible()
    await expect(page.getByText("Item E2E sesión uno")).toBeVisible()
    await expect(page.getByText("Item E2E sesión dos")).toBeVisible()

    // Quitar un item: el botón lleva aria-label con el nombre del producto.
    await page
      .getByRole("button", { name: "Eliminar Item E2E sesión uno del carrito" })
      .click()
    await expect(page.getByText("Item E2E sesión uno")).toHaveCount(0)
    await expect(
      page.getByRole("heading", { name: /Carrito \(1\)/ }),
    ).toBeVisible()

    // localStorage quedó sincronizado con lo que muestra el UI.
    await expect
      .poll(async () => {
        const storage = await dumpLocalStorage(page)
        const items = JSON.parse(storage[cartKey] ?? "[]") as CartSeedItem[]
        return items.map((i) => i.productId)
      })
      .toEqual(["E2E-SESSION-ITEM-2"])

    // Limpieza: dejar el carrito como estaba (vacío) en el navegador del
    // test. Es localStorage del contexto desechable — no toca servidor.
    await expectCleanPage(page, watch)
    await attachConsoleErrors(page, watch, testInfo)
  })
})

/**
 * Specs que ESCRIBEN en el servidor. Ejemplo de patrón — agregar aquí
 * cualquier flujo mutante (crear venta en el POS, confirmar reserva,
 * abrir caja). Requieren:
 *
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD + E2E_ALLOW_WRITES=1
 *
 * y un ambiente DESECHABLE (BD de prueba). Nunca contra reficio.app.
 */
test.describe("escritura — ambiente desechable", () => {
  test.skip(
    !hasAdminCreds || !allowWrites,
    "requiere E2E_ADMIN_* y E2E_ALLOW_WRITES=1 contra un ambiente desechable",
  )

  test("placeholder: documentar aquí el flujo mutante antes de habilitarlo", async () => {
    // Intencionalmente vacío: existe para fijar el patrón de gating.
    // Un spec real haría loginAsAdmin + flujo de escritura + asserts.
    test.skip(true, "sin specs de escritura todavía — placeholder del patrón")
  })
})
