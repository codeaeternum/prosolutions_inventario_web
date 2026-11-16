import { test, expect } from "@playwright/test"
import {
  choosePaymentMethod,
  confirmSale,
  createE2EProduct,
  ensureCajaOpen,
  findSale,
  firstBranch,
  loginAdminCached,
  uniqueTag,
  voidSale,
} from "./pilot-helpers"

/**
 * POS (/admin/ventas): venta real en EFECTIVO + verificación y limpieza.
 *
 * Flujo: alta de un producto E2E por API → ticket por búsqueda → cobro en
 * efectivo → la venta aparece en /api/sales → se anula (misma API del cajón
 * "Devoluciones / Tickets").
 *
 * ESCRIBE en el servidor: corre SOLO contra el pilot desechable, gated por
 * E2E_ALLOW_WRITES=1 + E2E_ADMIN_* (ver scripts/e2e-pilot.sh). Nunca contra
 * producción.
 */

const adminEmail = process.env.E2E_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD

test.describe("escritura — solo ambiente desechable", () => {
  // Un retry: el pilot (1 contenedor) a veces devuelve UNEXPECTED en ventas
  // bajo la carga de 9 workers — una falla real sigue fallando en el reintento.
  test.describe.configure({ retries: 1 })
  test.skip(
    !adminEmail || !adminPassword || process.env.E2E_ALLOW_WRITES !== "1",
    "requiere E2E_ADMIN_* y E2E_ALLOW_WRITES=1 contra un ambiente desechable (scripts/e2e-pilot.sh)",
  )

  test("POS: cobra una venta en EFECTIVO y la anula", async ({ page }) => {
    const tag = uniqueTag("E2E-VENTA")
    // El borrador del POS vive en localStorage: una sesión previa podía dejar
    // líneas fantasma en el ticket — se limpia antes de entrar.
    await page.addInitScript(() => localStorage.clear())
    await loginAdminCached(page, adminEmail!, adminPassword!)

    // Caja abierta en la sucursal activa o el efectivo rebota (409).
    const branch = await firstBranch(page)
    await ensureCajaOpen(page, branch.id)
    const product = await createE2EProduct(page, { tag, retailPrice: 10, stock: 8, branchId: branch.id })

    await page.goto("/admin/ventas")
    await expect(
      page.getByRole("heading", { name: /Punto de Venta/ }),
    ).toBeVisible({ timeout: 30_000 })

    // Alta en el ticket por búsqueda (el aria-label existe dos veces —
    // catálogo de escritorio + panel móvil — se toma el visible).
    const search = page.locator('input[aria-label="Buscar producto para vender"]:visible')
    await search.fill(tag)
    // La tarjeta del catálogo es el único botón con el nombre del producto
    // SIN aria-label (su nombre accesible empieza por el badge "N ud", así
    // que no se puede anclar). Los botones del ticket ("Reducir/Aumentar
    // cantidad de …") sí traen aria-label.
    const card = page.locator('button:not([aria-label]):visible', { hasText: tag }).first()
    await expect(card).toBeVisible()
    await card.click()

    // La línea entra al ticket y se habilita el cobro.
    await page.getByRole("button", { name: /Cobrar/ }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByText(/Método de pago/)).toBeVisible()

    // EFECTIVO es el método por defecto (caja abierta): el input de
    // referencia bancaria NO aparece — es exclusivo de transferencia.
    await expect(dialog.locator("#pos-transfer-ref")).toHaveCount(0)
    const cash = dialog.locator("#pos-cash-given")
    await expect(cash).toBeVisible()
    await cash.fill("10")

    // Confirmación: toast de éxito o error (con su texto) + la tarjeta
    // "Último movimiento registrado" + verdad persistida en /api/sales.
    const sale = await confirmSale(page, dialog, tag)
    await expect(page.getByText("Último movimiento registrado")).toBeVisible()

    expect(sale, `venta del producto ${tag} en /api/sales`).toBeTruthy()
    expect(sale.items.some(i => i.product.name === product.name)).toBe(true)
    const cashPayment = sale.payments.find(p => p.method === "CASH" && p.amount > 0)
    expect(cashPayment?.status).toBe("CONFIRMED")

    // Limpieza real: anular el ticket recién creado (reembolsa efectivo y
    // repone stock — prueba el flujo de void de punta a punta).
    await voidSale(page, sale!.id, `Limpieza E2E ${tag}`)
    await expect
      .poll(async () => (await findSale(page, tag))?.status, { timeout: 10_000 })
      .toBe("VOIDED")
    const after = (await findSale(page, tag))!
    const refunded = after.payments.find(p => p.method === "CASH" && p.amount < 0)
    expect(refunded, "la anulación debe registrar el reembolso en efectivo").toBeTruthy()
  })

  test("POS: transferencia sin folio se bloquea; con folio confirma", async ({ page }) => {
    await page.addInitScript(() => localStorage.clear())
    await loginAdminCached(page, adminEmail!, adminPassword!)

    const branch = await firstBranch(page)
    await ensureCajaOpen(page, branch.id)
    const tag = uniqueTag("E2E-METODO")
    await createE2EProduct(page, { tag, retailPrice: 10, stock: 5, branchId: branch.id })

    await page.goto("/admin/ventas")
    await page.locator('input[aria-label="Buscar producto para vender"]:visible').fill(tag)
    await page.locator('button:not([aria-label]):visible', { hasText: tag }).first().click()
    await page.getByRole("button", { name: /Cobrar/ }).click()
    const dialog = page.getByRole("dialog")

    // Cambiar a Transferencia SIN folio: el servidor/cliente lo bloquea —
    // la venta no se registra y el diálogo sigue abierto.
    await choosePaymentMethod(page, dialog, "Transferencia")
    await expect(dialog.locator("#pos-transfer-ref")).toBeVisible()
    await dialog.getByRole("button", { name: "Confirmar venta" }).click()
    await expect(
      page.getByText(/referencia de la transferencia/i).first(),
    ).toBeVisible({ timeout: 10_000 })
    await expect(dialog).toBeVisible()

    // Con folio sí confirma (la venta queda para limpieza).
    await dialog.locator("#pos-transfer-ref").fill(`E2E-TRF-${tag}`)
    const sale = await confirmSale(page, dialog, tag)
    await voidSale(page, sale.id, `Limpieza E2E ${tag}`)
  })
})
