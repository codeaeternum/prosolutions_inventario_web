import { expect, type Page } from "@playwright/test"

/**
 * Helpers compartidos de la suite E2E.
 *
 * Toda la suite pública es SOLO LECTURA contra el deploy (GET, render,
 * validación client-side, localStorage): ningún spec público envía POST que
 * persista datos. Los flujos que escriben viven en specs "requiere sesión"
 * gated por E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD (+ E2E_ALLOW_WRITES=1 si el
 * spec puede persistir en el servidor).
 */

// Claves espejo de src/components/cart-context.tsx
export const PUBLIC_CART_KEY = "cart:public"
export const CART_SCOPED_PREFIX = "cart:"
export const LEGACY_CART_KEY = "cart"

export interface CartSeedItem {
  productId: string
  name: string
  price: number
  quantity: number
  image?: string
  maxStock: number
}

/** Errores JS recolectados durante la navegación de una página. */
export interface PageWatch {
  /** Excepciones no capturadas (window.onerror / unhandledrejection). */
  pageErrors: string[]
  /** console.error que huelen a bug de React, no a ruido de red/terceros. */
  reactErrors: string[]
  /** Todos los console.error crudos (para adjuntar como diagnóstico). */
  consoleErrors: string[]
}

/**
 * Patrones de console.error que SÍ indican un render roto (hidratación,
 * hooks, render de React). El resto de console.error en producción puede
 * ser ruido legítimo (recursos 404, Cloudflare, extensiones) y se reporta
 * como diagnóstico sin tumbar el test.
 */
const REACT_ERROR_PATTERNS = [
  /Minified React error/i,
  /Hydration/i,
  /hydrat/i,
  /useLayoutEffect does nothing on the server/i,
  /Cannot read propert/i,
  /is not a function/i,
]

/**
 * Empieza a vigilar errores de página. Debe llamarse ANTES de page.goto().
 * Devuelve el colector; verifícalo con `expectCleanPage()` al final.
 */
export function watchPage(page: Page): PageWatch {
  const watch: PageWatch = { pageErrors: [], reactErrors: [], consoleErrors: [] }
  page.on("pageerror", (err) => {
    watch.pageErrors.push(String(err))
  })
  page.on("console", (msg) => {
    if (msg.type() !== "error") return
    const text = msg.text()
    watch.consoleErrors.push(text)
    if (REACT_ERROR_PATTERNS.some((re) => re.test(text))) {
      watch.reactErrors.push(text)
    }
  })
  return watch
}

/**
 * Invariantes de "render sano" para cualquier página:
 *  1. Sin excepciones JS no capturadas (pageerror).
 *  2. Sin console.error con olor a bug de React/hidratación.
 *  3. El body no muestra artefactos de serialización rota
 *     ("[object Object]", "undefined", "NaN") — clásicos de `.toString()`
 *     sobre objetos o números inválidos que se cuelan al HTML.
 */
export async function expectCleanPage(page: Page, watch: PageWatch) {
  expect(watch.pageErrors, "excepciones JS no capturadas").toEqual([])
  expect(
    watch.reactErrors,
    "console.error con patrón de bug de React",
  ).toEqual([])

  const bodyText = await page.locator("body").innerText()
  expect(bodyText).not.toContain("[object Object]")
  expect(bodyText).not.toMatch(/\bundefined\b/)
  expect(bodyText).not.toMatch(/\bNaN\b/)
}

/**
 * Alerta de error CON CONTENIDO. Next inyecta un
 * `[role="alert"]#__next-route-announcer__` vacío en todas las páginas:
 * `getByRole("alert")` a secas rompe el strict mode o aserta sobre el
 * announcer vacío. Este helper lo filtra.
 */
export function nonEmptyAlert(page: Page) {
  return page.getByRole("alert").filter({ hasText: /\S/ })
}

/** Adjunta los console.error crudos al reporte (diagnóstico, no falla). */
export async function attachConsoleErrors(
  page: Page,
  watch: PageWatch,
  testInfo: { attach: (name: string, opts: { body: string; contentType: string }) => Promise<void> },
) {
  if (watch.consoleErrors.length === 0) return
  await testInfo.attach("console-errors", {
    body: watch.consoleErrors.join("\n---\n"),
    contentType: "text/plain",
  })
}

/**
 * Siembra items en localStorage ANTES de que cargue la app (addInitScript).
 * El CartProvider los adopta al hidratar según el scope de sesión.
 */
export async function seedCart(
  page: Page,
  key: string,
  items: CartSeedItem[],
) {
  await page.addInitScript(
    ({ k, it }) => localStorage.setItem(k, JSON.stringify(it)),
    { k: key, it: items },
  )
}

/** Lee localStorage completo de la página ({clave: valor}). */
export function dumpLocalStorage(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!
      out[key] = localStorage.getItem(key) ?? ""
    }
    return out
  })
}

/**
 * Login por UI con un admin (form real de /login: #email + #password +
 * "Iniciar Sesión"). Tras el submit /login navega a /post-login, que
 * redirige por rol (ADMIN/EMPLOYEE → /admin*, WORKSHOP → /aliado,
 * superadmin → /platform).
 */
export async function loginAsAdmin(
  page: Page,
  email: string,
  password: string,
) {
  await page.goto("/login")
  await page.locator("#email").fill(email)
  await page.locator("#password").fill(password)
  await page.getByRole("button", { name: "Iniciar Sesión" }).click()
  await page.waitForURL(/\/(post-login|admin|aliado|platform|catalogo)/, {
    timeout: 30_000,
  })
}
