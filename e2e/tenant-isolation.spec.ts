import { test, expect, type Page } from "@playwright/test"

/**
 * Regresiones E2E de las fugas cross-tenant corregidas en el cliente.
 *
 * Las tres fugas vivían en localStorage con claves GLOBALES compartidas por
 * todos los tenants que pasaban por el mismo navegador:
 *
 *   - Notificaciones: `prosolutions_notifications` (global) → ahora
 *     `prosolutions_notifications:{businessId}:{userId}` y las claves legacy
 *     se purgan al hidratar el hook con sesión (src/lib/notification-cache.ts,
 *     src/hooks/use-notifications.ts).
 *   - Carrito: `cart` (global) → ahora `cart:{businessId}` / `cart:public`
 *     (src/components/cart-context.tsx).
 *   - Sucursal: `reficio-branch` podía conservar el id de una sucursal de
 *     OTRO negocio tras modo soporte; /admin/taller lo valida contra las
 *     sucursales del negocio y lo purga si no pertenece (src/app/admin/taller/page.tsx).
 *
 * Estos specs NO requieren backend/BD ni sesión: ejercitan el código de
 * cliente (localStorage + providers del layout raíz). Los que sí necesitan
 * sesión real quedan al final con test.skip documentado.
 */

// Claves espejo de src/lib/notification-cache.ts
const LEGACY_NOTIFICATION_KEY = "prosolutions_notifications"
const LEGACY_NOTIFICATION_CLEARED_KEY = "prosolutions_notifications_cleared_at"
const NOTIFICATION_SCOPED_PREFIX = "prosolutions_notifications:"

// Claves espejo de src/components/cart-context.tsx
const LEGACY_CART_KEY = "cart"
const PUBLIC_CART_KEY = "cart:public"
const CART_SCOPED_PREFIX = "cart:"

// Preferencia de sucursal (src/components/admin/branch-switcher.tsx et al.)
const BRANCH_PREF_KEY = "reficio-branch"

// UUID de un tenant/sucursal QUE NO EXISTE en este ambiente: cualquier dato
// que aparezca bajo este scope en la UI o en requests es una fuga.
const FOREIGN_BUSINESS_ID = "00000000-0000-4000-8000-0000000000aa"
const FOREIGN_BRANCH_ID = "00000000-0000-4000-8000-0000000000bb"

const FAKE_NOTIFICATION_TITLE = "FUGA-X-TENANT-NOTIF-7f3c2a"

const fakeNotification = {
  id: "e2e-fake-notif-1",
  type: "new_reservation",
  title: FAKE_NOTIFICATION_TITLE,
  message: "Notificación sembrada: pertenece a OTRO negocio",
  timestamp: new Date().toISOString(),
  read: false,
}

const legacyCartItems = [
  {
    productId: "LEGACY-PRODUCT-1",
    name: "Item del carrito legacy",
    price: 100,
    quantity: 2,
    maxStock: 10,
  },
]

const foreignCartItems = [
  {
    productId: "FOREIGN-ITEM-9",
    name: "Item del carrito de otro negocio",
    price: 999,
    quantity: 5,
    maxStock: 10,
  },
]

/** Lee localStorage completo en la página (devuelve {clave: valor}). */
function dumpLocalStorage(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!
      out[key] = localStorage.getItem(key) ?? ""
    }
    return out
  })
}

test.describe("aislamiento entre tenants — localStorage", () => {
  test("A: el caché legacy de notificaciones no se propaga ni se muestra", async ({
    page,
  }) => {
    // Siembra la clave GLOBAL heredada tal como la dejó una sesión de otro
    // negocio (modo soporte / cambio de cuenta). Es el estado exacto de la fuga.
    await page.addInitScript(
      ({ key, clearedKey, notification }) => {
        localStorage.setItem(key, JSON.stringify([notification]))
        localStorage.setItem(clearedKey, new Date(0).toISOString())
      },
      {
        key: LEGACY_NOTIFICATION_KEY,
        clearedKey: LEGACY_NOTIFICATION_CLEARED_KEY,
        notification: fakeNotification,
      },
    )

    const response = await page.goto("/")
    expect(response?.ok(), "la página pública debe cargar").toBeTruthy()
    await page.waitForLoadState("load")
    // La landing renderiza contenido propio; esperamos a que haya algo visible
    // para no evaluar el DOM a medio hidratar.
    await expect(page.locator("main").first()).toBeVisible()

    // 1) La notificación ajena jamás aparece en la UI pública.
    await expect(page.getByText(FAKE_NOTIFICATION_TITLE)).toHaveCount(0)
    await expect(
      page.getByText("Notificación sembrada: pertenece a OTRO negocio"),
    ).toHaveCount(0)

    // 2) Nadie creó un bucket scoped `prosolutions_notifications:*` copiando
    //    el legacy (sin sesión no hay scope → no hay nada legítimo que escribir).
    const storage = await dumpLocalStorage(page)
    const scopedKeys = Object.keys(storage).filter((k) =>
      k.startsWith(NOTIFICATION_SCOPED_PREFIX),
    )
    for (const scopedKey of scopedKeys) {
      expect(
        storage[scopedKey],
        `el feed ajeno no debe copiarse a ${scopedKey}`,
      ).not.toContain(fakeNotification.id)
      expect(storage[scopedKey]).not.toContain(FAKE_NOTIFICATION_TITLE)
    }

    // 3) Si el código purga la clave legacy al montar, mejor; si aún existe,
    //    es inerte (nadie la lee sin sesión) — lo que NO puede pasar es que el
    //    contenido haya llegado a la UI (verificado arriba).
  })

  test("B: el carrito queda bajo cart:public y no hereda items de otro negocio", async ({
    page,
  }) => {
    // Estado de fuga: quedó un `cart` global (legacy) Y un carrito scoped de
    // otro negocio. El provider debe migrar el legacy al scope público y NUNCA
    // mezclar el carrito scoped ajeno.
    await page.addInitScript(
      ({ legacyKey, foreignKey, legacyItems, foreignItems }) => {
        localStorage.setItem(legacyKey, JSON.stringify(legacyItems))
        localStorage.setItem(foreignKey, JSON.stringify(foreignItems))
      },
      {
        legacyKey: LEGACY_CART_KEY,
        foreignKey: `${CART_SCOPED_PREFIX}${FOREIGN_BUSINESS_ID}`,
        legacyItems: legacyCartItems,
        foreignItems: foreignCartItems,
      },
    )

    const response = await page.goto("/catalogo")
    expect(response?.ok(), "el catálogo público debe cargar").toBeTruthy()
    await page.waitForLoadState("load")

    // CartProvider espera a que useSession resuelva (`status !== "loading"`,
    // requiere /api/auth/session) antes de migrar — poll hasta que escriba.
    await expect
      .poll(async () =>
        page.evaluate((key) => localStorage.getItem(key), PUBLIC_CART_KEY),
      )
      .not.toBeNull()

    const storage = await dumpLocalStorage(page)

    // 1) El bucket público contiene SOLO los items migrados del legacy.
    const publicCart = JSON.parse(storage[PUBLIC_CART_KEY]) as Array<{
      productId: string
      quantity: number
    }>
    expect(publicCart.map((i) => i.productId)).toEqual(["LEGACY-PRODUCT-1"])
    expect(
      publicCart.some((i) => i.productId === "FOREIGN-ITEM-9"),
      "items de otro negocio no deben mezclarse en el carrito público",
    ).toBe(false)

    // 2) El legacy global quedó removido tras la migración.
    expect(
      storage[LEGACY_CART_KEY],
      "la clave global `cart` debe purgarse tras migrar a cart:public",
    ).toBeUndefined()

    // 3) El carrito del otro negocio permanece intacto en SU scope: ni se lee
    //    ni se destruye desde una sesión que no le pertenece.
    const foreignCart = JSON.parse(
      storage[`${CART_SCOPED_PREFIX}${FOREIGN_BUSINESS_ID}`],
    ) as Array<{ productId: string }>
    expect(foreignCart.map((i) => i.productId)).toEqual(["FOREIGN-ITEM-9"])

    // 4) El badge del carrito refleja solo los items propios (2), no la suma
    //    con los ajenos (que sería 7 si hubiera fuga).
    const badges = page.locator('a[aria-label^="Carrito ("]')
    await expect
      .poll(async () => badges.count(), "al menos un badge de carrito visible")
      .toBeGreaterThan(0)
    const labels = await badges.all()
    for (const badge of labels) {
      await expect(badge).toHaveAttribute(
        "aria-label",
        "Carrito (2 productos)",
      )
    }
  })

  test("C: una preferencia reficio-branch de otro tenant no se filtra a requests ni cookies", async ({
    page,
  }) => {
    // La preferencia de sucursal puede quedar con el id de OTRO negocio tras
    // modo soporte. En páginas públicas es inerte: nada debe leerla para
    // llamadas a la API ni propagarla a cookies.
    await page.addInitScript(
      ({ key, value }) => localStorage.setItem(key, value),
      { key: BRANCH_PREF_KEY, value: FOREIGN_BRANCH_ID },
    )

    const requestUrls: string[] = []
    page.on("request", (req) => requestUrls.push(req.url()))

    const response = await page.goto("/")
    expect(response?.ok()).toBeTruthy()
    await page.waitForLoadState("load")
    await expect(page.locator("main").first()).toBeVisible()
    // Pequeña ventana para efectos tardíos (providers, fetch de hidratación).
    await page.waitForTimeout(1500)

    // 1) Ninguna llamada de red arrastra el id ajeno (ni como branchId ni en path).
    const leaking = requestUrls.filter((url) => url.includes(FOREIGN_BRANCH_ID))
    expect(
      leaking,
      "ninguna request debe incluir el branchId de otro tenant",
    ).toEqual([])

    // 2) Nadie lo promovió a cookie (la app solo lo espeja a cookie en flujos
    //    admin; en público no hay quien lo escriba).
    const cookies = await page.context().cookies()
    expect(
      cookies.find((c) => c.name === BRANCH_PREF_KEY)?.value,
      "la preferencia ajena no debe copiarse a cookie",
    ).not.toBe(FOREIGN_BRANCH_ID)

    // Nota: la PURGA activa de reficio-branch ocurre en /admin/taller cuando el
    // id no pertenece a las sucursales del negocio autenticado — ese flujo
    // requiere sesión y está cubierto en el describe "requiere sesión".
  })
})

/**
 * Flujos que SÍ requieren sesión real multi-tenant.
 *
 * Para habilitarlos se necesita una base de datos con dos negocios sembrados
 * y estas variables de entorno (NO existen fixtures de usuarios en el repo):
 *
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD — admin del negocio A
 *   E2E_SUPPORT_EMAIL / E2E_SUPPORT_PASSWORD — superadmin o cuenta con modo
 *     soporte al negocio B (para reproducir el escenario original de la fuga)
 *
 * Con eso, cada test haría login por UI (/login → #email + #password →
 * "Iniciar Sesión") y verificaría los mismos invariantes pero autenticado.
 */
test.describe("requiere sesión", () => {
  const adminEmail = process.env.E2E_ADMIN_EMAIL
  const adminPassword = process.env.E2E_ADMIN_PASSWORD
  const hasAdminCreds = Boolean(adminEmail && adminPassword)

  test.skip(
    !hasAdminCreds,
    "requiere E2E_ADMIN_EMAIL y E2E_ADMIN_PASSWORD con un usuario admin sembrado en la BD del ambiente",
  )

  async function loginAsAdmin(page: Page) {
    await page.goto("/login")
    await page.locator("#email").fill(adminEmail!)
    await page.locator("#password").fill(adminPassword!)
    await page.getByRole("button", { name: "Iniciar Sesión" }).click()
    await page.waitForURL(/\/(post-login|admin|catalogo)/, { timeout: 30_000 })
  }

  test("A1: con sesión, el feed legacy se purga y el badge no muestra notificaciones ajenas", async ({
    page,
  }) => {
    await page.addInitScript(
      ({ key, notification }) => {
        localStorage.setItem(key, JSON.stringify([notification]))
      },
      { key: LEGACY_NOTIFICATION_KEY, notification: fakeNotification },
    )
    await loginAsAdmin(page)
    await page.goto("/admin")
    // El hook purga LEGACY_NOTIFICATION_KEYS al resolver el scope businessId:userId.
    await expect
      .poll(async () =>
        page.evaluate((key) => localStorage.getItem(key), LEGACY_NOTIFICATION_KEY),
      )
      .toBeNull()
    await expect(page.getByText(FAKE_NOTIFICATION_TITLE)).toHaveCount(0)
  })

  test("B1: con sesión del negocio A, el carrito se guarda en cart:{businessIdA}", async ({
    page,
  }) => {
    await page.addInitScript(
      ({ foreignKey, foreignItems }) => {
        localStorage.setItem(foreignKey, JSON.stringify(foreignItems))
      },
      {
        foreignKey: `${CART_SCOPED_PREFIX}${FOREIGN_BUSINESS_ID}`,
        foreignItems: foreignCartItems,
      },
    )
    await loginAsAdmin(page)
    await page.goto("/catalogo")
    // El scope del carrito debe ser el businessId de la sesión, nunca el ajeno.
    const keys = await page.evaluate(() => {
      const out: string[] = []
      for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i)!)
      return out.filter((k) => k.startsWith("cart:"))
    })
    expect(keys).not.toContain(PUBLIC_CART_KEY)
    expect(keys.some((k) => k.includes(FOREIGN_BUSINESS_ID))).toBe(true) // el ajeno sigue en su scope
    expect(keys.some((k) => k !== `${CART_SCOPED_PREFIX}${FOREIGN_BUSINESS_ID}`)).toBe(true)
  })

  test("C1: /admin/taller purga reficio-branch cuando la sucursal no es del negocio", async ({
    page,
  }) => {
    await page.addInitScript(
      ({ key, value }) => localStorage.setItem(key, value),
      { key: BRANCH_PREF_KEY, value: FOREIGN_BRANCH_ID },
    )
    await loginAsAdmin(page)
    await page.goto("/admin/taller")
    // load() compara `branch` contra las sucursales del negocio y lo descarta.
    await expect
      .poll(async () =>
        page.evaluate((key) => localStorage.getItem(key), BRANCH_PREF_KEY),
      )
      .toBeNull()
  })
})
