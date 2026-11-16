import { expect, type Page } from "@playwright/test"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync, writeFileSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loginAsAdmin } from "./helpers"

/**
 * Helpers de los specs de ESCRITURA contra el ambiente pilot (desechable).
 *
 * Todo lo que persiste en el servidor se crea con prefijo "E2E-" + timestamp
 * para distinguirlo en la BD del pilot y limpiarlo a mano si hiciera falta.
 *
 * Las rutas API se llaman con `page.evaluate(fetch)` — va la cookie de sesión
 * del login real y se ejercita la misma superficie que usa el frontend.
 */

/**
 * Login con sesión compartida entre workers.
 *
 * El endpoint de login limita por IP (30 intentos / 15 min por callback de
 * credenciales — y sin TRUST_PROXY_HEADERS toda la suite comparte el bucket
 * "direct-clients"). Un login por test agota el bucket a mitad de suite, así
 * que el primer worker que llega hace el login real y guarda las cookies en
 * un archivo bajo tmpdir; el resto las reutiliza (la cookie NextAuth es un
 * JWT — sigue válida en otro contexto del mismo origen).
 *
 * El claim es atómico (open 'wx'): solo un worker escribe; los demás esperan
 * a que el archivo tenga contenido y lo reutilizan.
 */
const SESSION_TTL_MS = 10 * 60 * 1000

function sessionPath(): string {
  const key = createHash("sha1")
    .update(process.env.E2E_BASE_URL ?? "http://localhost:3000")
    .digest("hex")
    .slice(0, 10)
  return join(tmpdir(), `e2e-pilot-session-${key}.json`)
}

type StoredCookies = {
  cookies?: {
    name: string
    value: string
    domain: string
    path: string
    expires: number
    httpOnly: boolean
    secure: boolean
    sameSite: "Strict" | "Lax" | "None"
  }[]
}

async function attachCachedSession(page: Page): Promise<boolean> {
  const path = sessionPath()
  try {
    if (!existsSync(path) || Date.now() - statSync(path).mtimeMs > SESSION_TTL_MS) return false
    const state = JSON.parse(readFileSync(path, "utf8")) as StoredCookies
    if (!state.cookies?.length) return false
    await page.context().addCookies(state.cookies)
    // Validación real: una ruta de admin NO debe rebotar a /login.
    await page.goto("/admin/ventas")
    return !page.url().includes("/login")
  } catch {
    return false
  }
}

export async function loginAdminCached(page: Page, email: string, password: string) {
  const path = sessionPath()
  if (await attachCachedSession(page)) return

  for (let attempt = 0; attempt < 3; attempt++) {
    // Reclamar el slot de "quien hace el login" de forma atómica.
    let claimed = false
    try {
      writeFileSync(path, "", { flag: "wx" })
      claimed = true
    } catch { /* el archivo ya existe — otro worker o un claim viejo */ }

    if (!claimed) {
      // Esperar a que el claimer escriba las cookies. Si el archivo sigue
      // vacío tras ~15 s, el claimer murió a medias: robar el slot.
      const deadline = Date.now() + 15_000
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 250))
        try {
          if (statSync(path).size > 10) {
            if (await attachCachedSession(page)) return
            break
          }
        } catch { /* archivo a medias — seguir esperando */ }
      }
      try {
        if (statSync(path).size <= 10) unlinkSync(path)
      } catch { /* ya no existe — reintentar el claim */ }
      continue
    }

    try {
      await loginAsAdmin(page, email, password)
      const state = await page.context().storageState()
      writeFileSync(path, JSON.stringify(state))
      return
    } catch (error) {
      // Liberar el slot vacío para que el siguiente worker reintente.
      try {
        if (statSync(path).size <= 10) unlinkSync(path)
      } catch { /* nada */ }
      throw error
    }
  }

  // Último recurso: reintentar cache o login propio sin persistir.
  if (await attachCachedSession(page)) return
  await loginAsAdmin(page, email, password)
}


export interface PilotBranch {
  id: string
  name: string
}

export interface PilotSale {
  id: string
  number: number
  status: "COMPLETED" | "VOIDED" | "DRAFT" | "OPEN"
  kind: string
  total: number
  branchId: string
  items: {
    id: string
    productId: string
    quantity: number
    returnedQuantity: number
    unitPrice: number
    product: { id: string; name: string }
  }[]
  payments: {
    id: string
    method: string
    amount: number
    status: string
    reference?: string | null
  }[]
}

/** Fetch autenticado dentro de la página (misma cookie que el frontend). */
export async function api<T = unknown>(
  page: Page,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; data: T | null }> {
  return page.evaluate(
    async ({ p, m, b }) => {
      const res = await fetch(p, {
        method: m ?? "GET",
        // no-store: builds viejos del pilot no mandan Cache-Control en las API
        // y el fetch podía servir una lectura en caché heurística (p. ej. una
        // venta todavía COMPLETED justo después de anularla).
        cache: "no-store",
        headers: b !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: b !== undefined ? JSON.stringify(b) : undefined,
      })
      const data = (await res.json().catch(() => null)) as unknown
      return { status: res.status, data: data as never }
    },
    { p: path, m: init?.method, b: init?.body },
  )
}

export function uniqueTag(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`
}

/** Sucursal visible del POS: la primera activa del negocio. */
export async function firstBranch(page: Page): Promise<PilotBranch> {
  const { status, data } = await api<{ branches?: { id: string; name: string; isActive?: boolean }[] }>(page, "/api/branches")
  expect(status, "GET /api/branches").toBe(200)
  const branch = (data?.branches ?? []).find(b => b.isActive !== false) ?? data?.branches?.[0]
  expect(branch, "el pilot debe tener al menos una sucursal").toBeTruthy()
  return { id: branch!.id, name: branch!.name }
}

/**
 * Garantiza caja abierta en la sucursal: sin ella el cobro en EFECTIVO
 * rebota con 409 REGISTER_REQUIRED. La apertura misma es escritura real.
 */
export async function ensureCajaOpen(page: Page, branchId: string): Promise<void> {
  const { status, data } = await api<{ active?: boolean }>(page, `/api/caja?branchId=${encodeURIComponent(branchId)}`)
  expect(status, "GET /api/caja").toBe(200)
  if (data?.active) return
  const open = await api(page, "/api/caja", {
    method: "POST",
    body: {
      action: "OPEN",
      amount: 1000,
      branchId,
      idempotencyKey: crypto.randomUUID(),
    },
  })
  expect(open.status, `abrir caja en ${branchId}: ${JSON.stringify(open.data)}`).toBeLessThan(300)
}

let cachedCategoryId: string | null = null

/** Primera categoría del tenant (la alta de producto la exige). */
export async function firstCategoryId(page: Page): Promise<string> {
  if (cachedCategoryId) return cachedCategoryId
  const { status, data } = await api<{ id: string; name: string }[] | { categories?: { id: string; name: string }[] }>(page, "/api/categories")
  expect(status, "GET /api/categories").toBe(200)
  const list = Array.isArray(data) ? data : (data?.categories ?? [])
  expect(list.length, "el pilot debe tener categorías").toBeGreaterThan(0)
  cachedCategoryId = list[0].id
  return cachedCategoryId
}

/**
 * Crea un producto E2E por API (mismo endpoint que el alta del panel):
 * universal (sin modelos), con existencias en la sucursal indicada.
 */
export async function createE2EProduct(
  page: Page,
  input: { tag: string; retailPrice: number; stock: number; branchId: string },
): Promise<{ id: string; name: string }> {
  const categoryId = await firstCategoryId(page)
  const { status, data } = await api<{ id?: string; name?: string; error?: string }>(page, "/api/products", {
    method: "POST",
    body: {
      name: input.tag,
      retailPrice: input.retailPrice,
      stock: input.stock,
      minStock: 1,
      isUniversal: true,
      categoryId,
      stockBranchId: input.branchId,
      idempotencyKey: crypto.randomUUID(),
    },
  })
  expect(status, `POST /api/products (${input.tag}): ${JSON.stringify(data)}`).toBeLessThan(300)
  expect(data?.id).toBeTruthy()
  return { id: data!.id!, name: data!.name ?? input.tag }
}

/**
 * Encuentra una venta por nombre de artículo o folio.
 *
 * Las builds viejas del pilot ignoran ?q= por completo (devuelven el
 * historial entero), así que el filtrado va del lado del cliente: se barren
 * páginas (20 ventas c/u, recientes primero) y se busca el match en los
 * artículos. Con ?q= funcionando, la página 1 ya trae la venta y corta antes.
 */
export async function findSale(page: Page, query: string): Promise<PilotSale | null> {
  for (let p = 1; p <= 5; p++) {
    const { status, data } = await api<{ sales?: PilotSale[] }>(
      page,
      `/api/sales?page=${p}&q=${encodeURIComponent(query)}`,
    )
    expect(status, "GET /api/sales").toBe(200)
    const sales = data?.sales ?? []
    const hit = sales.find(s => s.items.some(i => i.product.name.includes(query)))
    if (hit) return hit
    if (sales.length < 20) break
  }
  return null
}

/**
 * Confirma el diálogo de cobro y verifica la venta de verdad:
 *  1. Espera el toast de éxito "Venta #… registrada" o un toast de error —
 *     el que salga primero. Si es error, falla con SU texto (diagnóstico
 *     real: el toast de sonner se auto-descarta y sin esto el spec se queda
 *     mirando un diálogo abierto sin saber por qué).
 *  2. La persistencia es la verdad de tierra: poll a /api/sales hasta
 *     COMPLETED (bajo carga el POST puede tardar o el toast perderse).
 */
export async function confirmSale(
  page: Page,
  dialog: ReturnType<Page["locator"]>,
  tag: string,
): Promise<PilotSale> {
  await dialog.getByRole("button", { name: "Confirmar venta" }).click()

  const toastRegion = page.getByRole("region", { name: /Notifications/i })
  const okToast = toastRegion.getByText(/Venta #?\d+ registrada/i).first()
  const errToast = toastRegion
    .getByText(/no se|error|requiere|insuficiente|caja|intenta|invá/i)
    .first()

  const outcome = await Promise.race([
    okToast.waitFor({ timeout: 45_000 }).then(() => "ok" as const).catch(() => "timeout" as const),
    errToast.waitFor({ timeout: 45_000 }).then(async () => `toast-error: ${await errToast.textContent()}` as const).catch(() => "timeout" as const),
  ])
  expect(outcome, "el cobro no confirmó").toBe("ok")

  await expect
    .poll(async () => (await findSale(page, tag))?.status, {
      timeout: 20_000,
      intervals: [300, 700, 1500, 3000],
    })
    .toBe("COMPLETED")
  return (await findSale(page, tag))!
}

/**
 * Anula una venta recién creada (limpieza de los specs). Es la misma API que
 * usa el cajón "Devoluciones / Tickets" del POS.
 */
export async function voidSale(page: Page, saleId: string, reason: string): Promise<number> {
  const { status, data } = await api<{ error?: string }>(page, `/api/sales/${saleId}/void`, {
    method: "POST",
    body: { reason, idempotencyKey: crypto.randomUUID() },
  })
  expect(status, `anular venta ${saleId}: ${JSON.stringify(data)}`).toBe(200)
  return status
}

/**
 * Elige un método de pago en el diálogo de cobro. El Select del pilot es un
 * dropdown propio (trigger <button> + [data-select-item]); versiones nuevas
 * usan Radix (role=option). Soporta ambos para sobrevivir al drift de imagen.
 */
export async function choosePaymentMethod(page: Page, dialog: ReturnType<Page["locator"]>, label: string) {
  // El trigger es el botón que muestra el método vigente dentro de "Método de pago".
  const trigger = dialog
    .getByRole("button", { name: /^(Efectivo|Tarjeta|Transferencia|A crédito)/ })
    .first()
  await trigger.click()
  const radixOption = page.getByRole("option", { name: new RegExp(label, "i") })
  if (await radixOption.count()) {
    await radixOption.first().click()
    return
  }
  await dialog.locator("[data-select-item]", { hasText: label }).first().click()
}
