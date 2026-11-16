import { test, expect } from "@playwright/test"
import { api, loginAdminCached, uniqueTag } from "./pilot-helpers"

/**
 * Catálogo (/admin/inventario): alta de producto por UI + borrado por API.
 *
 * El alta es por el diálogo real "Dar de alta producto" (#pf-name,
 * #pf-category, #pf-retail, #pf-universal). El borrado no existe en la UI —
 * va por DELETE /api/products/[id], que exige stock 0: el producto se crea
 * SIN existencias (los campos por sucursal quedan vacíos → stock 0).
 *
 * ESCRIBE en el servidor: solo pilot desechable + E2E_ALLOW_WRITES=1.
 */

const adminEmail = process.env.E2E_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD

test.describe("escritura — solo ambiente desechable", () => {
  test.describe.configure({ retries: 1 })
  test.skip(
    !adminEmail || !adminPassword || process.env.E2E_ALLOW_WRITES !== "1",
    "requiere E2E_ADMIN_* y E2E_ALLOW_WRITES=1 contra un ambiente desechable (scripts/e2e-pilot.sh)",
  )

  test("alta de producto por UI y borrado por API (stock 0)", async ({ page }) => {
    const tag = uniqueTag("E2E-TEST")
    await loginAdminCached(page, adminEmail!, adminPassword!)

    await page.goto("/admin/inventario")
    await expect(page.getByRole("heading", { name: "Inventario" })).toBeVisible({ timeout: 30_000 })

    await page.getByRole("button", { name: "Dar de alta" }).first().click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByText("Dar de alta producto")).toBeVisible()

    await dialog.locator("#pf-name").fill(tag)
    // Primera categoría real del select nativo.
    const firstValue = await dialog.locator("#pf-category option").nth(1).getAttribute("value")
    expect(firstValue, "debe haber al menos una categoría").toBeTruthy()
    await dialog.locator("#pf-category").selectOption(firstValue!)
    await dialog.locator("#pf-retail").fill("10")
    // Universal: el alta sin modelos compatibles rebota en el servidor.
    await dialog.locator("#pf-universal").check()
    // Sin existencias: los campos "Stock inicial" quedan vacíos → stock 0
    // (condición que exige el DELETE para borrar el producto después).

    await dialog.getByRole("button", { name: "Dar de alta", exact: true }).click()
    await expect(
      page.getByText(/Producto dado de alta|error/i).first(),
    ).toBeVisible({ timeout: 30_000 })
    await expect(dialog).toBeHidden({ timeout: 15_000 })

    // Aparece en la lista al buscarlo por nombre.
    const search = page.getByLabel(/Buscar productos por nombre o código/)
    await search.fill(tag)
    await expect(page.getByRole("button", { name: new RegExp(`Editar ${tag}`) }).first()).toBeVisible({ timeout: 15_000 })

    // Borrado por API (no hay botón de eliminar en la UI): stock 0 pasa la
    // guarda del DELETE.
    const lookup = await api<{ products?: { id: string; name: string; stock?: number }[] }>(
      page,
      `/api/products?search=${encodeURIComponent(tag)}&limit=5`,
    )
    expect(lookup.status).toBe(200)
    const created = lookup.data?.products?.find(p => p.name === tag)
    expect(created, "el producto E2E debe existir vía API").toBeTruthy()

    const del = await api<{ ok?: boolean; error?: string }>(page, `/api/products/${created!.id}`, { method: "DELETE" })
    expect(del.status, JSON.stringify(del.data)).toBe(200)

    // Ya no aparece ni en API ni en la lista.
    const gone = await api<{ products?: { id: string }[] }>(page, `/api/products?search=${encodeURIComponent(tag)}&limit=5`)
    expect(gone.data?.products?.some(p => p.id === created!.id) ?? false).toBe(false)
    await search.fill(tag)
    await expect(page.getByRole("button", { name: new RegExp(`Editar ${tag}`) })).toHaveCount(0)
  })
})
