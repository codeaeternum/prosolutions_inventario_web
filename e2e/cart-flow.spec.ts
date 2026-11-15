import { test, expect } from "@playwright/test"
import {
  attachConsoleErrors,
  dumpLocalStorage,
  expectCleanPage,
  PUBLIC_CART_KEY,
  seedCart,
  watchPage,
  type CartSeedItem,
} from "./helpers"

/**
 * Flujo de carrito — SOLO client-side (localStorage), seguro contra producción.
 *
 * Cómo funciona el carrito anónimo en esta app (leído del código, no
 * suposiciones):
 *
 *  - El CartProvider persiste en `cart:public` sin sesión
 *    (src/components/cart-context.tsx).
 *  - En /catalogo el botón "Agregar" de una tarjeta NO guarda nada sin
 *    sesión: muestra toast y redirige a /login?callbackUrl=/catalogo
 *    (src/app/catalogo/page.tsx handleAddToCartClick).
 *  - /carrito es ruta "legacy" para anónimos: el proxy los manda a
 *    /?redirect=bot (src/lib/auth.config.ts, regla 1). La página del
 *    carrito con quitar/editar items solo se ejerce con sesión — ese
 *    flujo vive en admin-smoke.spec.ts (gated por E2E_ADMIN_*).
 *  - Lo que SÍ se ejerce sin sesión: la hidratación de `cart:public` y el
 *    badge "Carrito (N productos)" del header del catálogo.
 *
 * Nada de esto hace checkout ni toca /api/reservations.
 */

const SEED_ITEMS: CartSeedItem[] = [
  {
    productId: "E2E-PRODUCT-A",
    name: "Pantalla de prueba E2E",
    price: 1500,
    quantity: 2,
    maxStock: 10,
  },
  {
    productId: "E2E-PRODUCT-B",
    name: "Batería de prueba E2E",
    price: 800,
    quantity: 1,
    maxStock: 10,
  },
]

test.describe("carrito — vitrina anónima", () => {
  test("Agregar sin sesión redirige a /login (no escribe el carrito)", async ({
    page,
  }, testInfo) => {
    const watch = watchPage(page)
    await page.goto("/catalogo")
    await page.waitForLoadState("load")

    // Espera al estado final del grid: tarjetas, vacío o error.
    const productCards = page.getByRole("button", { name: /Ver detalles de / })
    const emptyState = page.getByText("No se encontraron productos")
    const errorState = page
      .getByRole("alert")
      .filter({ hasText: "No se pudo cargar el catálogo" })
    await expect(
      productCards.first().or(emptyState).or(errorState),
    ).toBeVisible({ timeout: 30_000 })

    // Solo las tarjetas con disponibilidad muestran "Agregar".
    const addButtons = page.getByRole("button", { name: "Agregar" })
    test.skip(
      (await addButtons.count()) === 0,
      "este ambiente no tiene productos disponibles en la vitrina",
    )

    await addButtons.first().click()

    // Regla de negocio: sin sesión no se reserva — se pide login con
    // callback de vuelta al catálogo.
    await page.waitForURL(/\/login\?callbackUrl=/, { timeout: 20_000 })
    expect(decodeURIComponent(page.url())).toContain("/catalogo")
    await expect(page.locator("#email")).toBeVisible()

    // Y el carrito NO recibió el producto: nada en cart:public más allá
    // del array vacío que el provider persiste al hidratar.
    await expect
      .poll(async () => {
        const storage = await dumpLocalStorage(page)
        const raw = storage[PUBLIC_CART_KEY]
        return raw ? (JSON.parse(raw) as unknown[]).length : 0
      })
      .toBe(0)

    await attachConsoleErrors(page, watch, testInfo)
    expect(watch.pageErrors).toEqual([])
  })

  test("cart:public hidrata el badge del header con el conteo correcto", async ({
    page,
  }, testInfo) => {
    const watch = watchPage(page)
    // 2 + 1 = 3 unidades → "Carrito (3 productos)".
    await seedCart(page, PUBLIC_CART_KEY, SEED_ITEMS)
    await page.goto("/catalogo")
    await page.waitForLoadState("load")

    const cartLink = page.locator('a[aria-label^="Carrito ("]')
    // El provider espera a que /api/auth/session resuelva antes de hidratar.
    await expect
      .poll(
        async () => cartLink.count(),
        { message: "badge del carrito visible tras hidratar cart:public" },
      )
      .toBeGreaterThan(0)
    for (const badge of await cartLink.all()) {
      await expect(badge).toHaveAttribute(
        "aria-label",
        "Carrito (3 productos)",
      )
    }

    // El provider re-persiste el mismo contenido: sin corrupción ni items
    // fantasmas tras la reescritura.
    const storage = await dumpLocalStorage(page)
    const saved = JSON.parse(storage[PUBLIC_CART_KEY]) as CartSeedItem[]
    expect(
      saved.map((i) => i.productId).sort(),
      "cart:public conserva solo los items sembrados",
    ).toEqual(["E2E-PRODUCT-A", "E2E-PRODUCT-B"])
    expect(saved.reduce((n, i) => n + i.quantity, 0)).toBe(3)

    await attachConsoleErrors(page, watch, testInfo)
    expect(watch.pageErrors).toEqual([])
    await expectCleanPage(page, watch)
  })

  test("el badge del carrito lleva a /carrito → anónimo rebota a /?redirect=bot", async ({
    page,
  }, testInfo) => {
    const watch = watchPage(page)
    await seedCart(page, PUBLIC_CART_KEY, SEED_ITEMS.slice(0, 1))
    await page.goto("/catalogo")
    await page.waitForLoadState("load")

    const cartLink = page.locator('a[aria-label^="Carrito ("]').first()
    await expect(cartLink).toBeVisible()

    await Promise.all([
      page.waitForURL(/redirect=bot/, { timeout: 20_000 }),
      cartLink.click(),
    ])
    // Aterriza en la landing sana: main visible, sin crash.
    await expect(page.locator("main#main-content")).toBeVisible()

    await attachConsoleErrors(page, watch, testInfo)
    expect(watch.pageErrors).toEqual([])
    await expectCleanPage(page, watch)
  })
})
