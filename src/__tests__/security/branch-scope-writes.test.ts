import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Alcance de sucursal/módulo/rol del EMPLOYEE — escrituras y documentos.
 *
 * - PATCH/POST /api/workshop/[id]: la orden radicada en otra sucursal es 403
 *   antes de delegar al dominio (la propia llega al dominio → 404 controlado).
 * - POST/DELETE /api/workshop/[id]/photos: misma barrera para la evidencia.
 * - /admin/tickets/[tipo]/[id] y /admin/tickets/corte/[id]: documento de otra
 *   sucursal → notFound(); abono exige módulo clientes; corte exige caja y su
 *   groupBy de métodos incluye VOIDED (cobro anulado + reembolso cancelan a 0).
 * - POST /api/supplier-payments: liquidar la cuenta por pagar es solo-admin.
 * - POST /api/notifications/read: exige el módulo notificaciones.
 * - SSE: el stream revalida rol y módulos contra el snapshot del conectar.
 */

// ——— Prisma mock: Proxy que auto-crea un vi.fn() por model.method ———
const db = vi.hoisted(() => ({
  fn: {} as Record<string, ReturnType<typeof vi.fn>>,
}))

const prismaMock = vi.hoisted(() => {
  const defaults: Record<string, unknown> = {
    findUnique: null,
    findFirst: null,
    count: 0,
    aggregate: { _sum: {}, _count: { _all: 0 } },
  }
  const cache = new Map<string, unknown>()
  return new Proxy({} as Record<string, unknown>, {
    get: (_t, prop: string) => {
      // $transaction/$queryRaw/$connect… son funciones del cliente, no modelos.
      if (prop.startsWith("$")) {
        return (db.fn[prop] ??= vi.fn().mockResolvedValue([]))
      }
      if (!cache.has(prop)) {
        cache.set(prop, new Proxy({} as Record<string, unknown>, {
          get: (_t2, method: string) => {
            const key = `${prop}.${method}`
            return (db.fn[key] ??= vi.fn().mockResolvedValue(method in defaults ? defaults[method] : []))
          },
        }))
      }
      return cache.get(prop)
    },
  })
})

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND") }),
  redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`) }),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth, handlers: { GET: vi.fn(), POST: vi.fn() } }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock, default: prismaMock }))
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }))

import type { NextRequest } from "next/server"
import { PATCH as workshopUpdate } from "@/app/api/workshop/[id]/route"
import { POST as photoUpload, DELETE as photoDelete } from "@/app/api/workshop/[id]/photos/route"
import { POST as supplierPay } from "@/app/api/supplier-payments/route"
import { POST as notificationsRead } from "@/app/api/notifications/read/route"
import { GET as notificationStream, sendNotificationToStaff } from "@/app/api/notifications/stream/route"
import TicketPage from "@/app/admin/tickets/[tipo]/[id]/page"
import CorteTicketPage from "@/app/admin/tickets/corte/[id]/page"

const staff = (role: string, opts: { modules?: string[]; branches?: string[] } = {}) => ({
  user: {
    id: `${role.toLowerCase()}-1`, role, status: "APPROVED", businessId: "biz-test",
    customerType: "NORMAL",
    allowedModules: opts.modules ?? [], allowedBranchIds: opts.branches ?? [],
  },
})
/** Empleado asignado solo a la sucursal b1 con los módulos dados. */
const restricted = (modules: string[]) => staff("EMPLOYEE", { modules, branches: ["b1"] })

const nx = (req: Request) => req as unknown as NextRequest
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const post = (url: string, body: unknown) => new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
/** Acceso al mock auto-generado (ver branch-scope-reads-2): q("sale.findUnique"). */
const q = (key: string) => {
  const [model, method] = key.split(".")
  const p = prismaMock as Record<string, unknown>
  if (key.startsWith("$")) void p[key]
  else void (p[model] as Record<string, unknown>)?.[method]
  return db.fn[key]
}
/** Empleado que sí pasa actor() dentro del dominio (tx falso). */
const txStaffUser = { id: "employee-1", role: "EMPLOYEE", status: "APPROVED", businessId: "biz-test" }

const saleRow = (branchId: string) => ({
  id: "s-1", businessId: "biz-test", branchId, number: 1, kind: "RETAIL", status: "COMPLETED",
  total: 100, discountCents: 0, discountReason: null, note: null, expiresAt: null,
  items: [], payments: [], seller: { name: "Cajero" }, customer: null,
  branch: { id: branchId, name: "Sucursal" }, createdAt: new Date(),
})
const registerRow = (branchId: string) => ({
  id: "reg-1", businessId: "biz-test", status: "CLOSED", branchId,
  openedAt: new Date(Date.now() - 3600000), closedAt: new Date(),
  initialAmount: 100, finalAmount: 100, denominations: null, notes: null,
  branch: { name: "Sucursal" }, openedBy: { name: "A" }, closedBy: { name: "B" }, movements: [],
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(null)
  // Tx falso: las operaciones del dominio corren contra el mismo proxy; el
  // actor queda aprobado y las entidades faltantes resuelven a 404 — así un
  // request permitido demuestra que llegó al dominio.
  q("$transaction").mockImplementation(async (work: (t: unknown) => unknown) => work(prismaMock))
  q("user.findUnique").mockResolvedValue(txStaffUser)
})

describe("PATCH /api/workshop/[id] — la orden delimita quién la opera", () => {
  const body = { idempotencyKey: "op:test-0001", expectedVersion: 1, action: "STATUS", status: "DIAGNOSIS" }

  it("orden de otra sucursal es 403 sin abrir transacción", async () => {
    mocks.auth.mockResolvedValue(restricted(["taller"]))
    q("repairOrder.findUnique").mockResolvedValue({ id: "o1", currentBranchId: "b2" })
    const res = await workshopUpdate(post("https://app.invalid/api/workshop/o1", body), params("o1"))
    expect(res.status).toBe(403)
    expect(q("$transaction")).not.toHaveBeenCalled()
  })

  it("la propia llega al dominio (orden hallada, sucursal asignada)", async () => {
    mocks.auth.mockResolvedValue(restricted(["taller"]))
    q("repairOrder.findUnique")
      .mockResolvedValueOnce({ id: "o1", currentBranchId: "b1" }) // guardia de la ruta
      .mockResolvedValue(null) // dentro del dominio la tx no la ve → 404
    const res = await workshopUpdate(post("https://app.invalid/api/workshop/o1", body), params("o1"))
    expect(res.status).toBe(404)
    expect(q("$transaction")).toHaveBeenCalled()
  })

  it("TRANSFER con destino ajeno sigue siendo 403 aunque la orden sea propia", async () => {
    mocks.auth.mockResolvedValue(restricted(["taller"]))
    q("repairOrder.findUnique").mockResolvedValue({ id: "o1", currentBranchId: "b1" })
    const res = await workshopUpdate(post("https://app.invalid/api/workshop/o1", { ...body, action: "TRANSFER", branchId: "b2", detail: "Mover" }), params("o1"))
    expect(res.status).toBe(403)
    expect(q("$transaction")).not.toHaveBeenCalled()
  })
})

describe("workshop/[id]/photos — evidencia acotada a la sucursal de la orden", () => {
  it("POST sobre orden ajena es 403 antes de leer el archivo", async () => {
    mocks.auth.mockResolvedValue(restricted(["taller"]))
    q("repairOrder.findUnique").mockResolvedValue({ id: "o1", status: "IN_REPAIR", currentBranchId: "b2" })
    const res = await photoUpload(new Request("https://app.invalid/api/workshop/o1/photos", { method: "POST" }), params("o1"))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: "No tienes acceso a esta sucursal." })
    expect(q("repairPhoto.create")).not.toHaveBeenCalled()
  })

  it("POST sobre orden propia pasa la barrera (sin archivo → 400 del dominio)", async () => {
    mocks.auth.mockResolvedValue(restricted(["taller"]))
    q("repairOrder.findUnique").mockResolvedValue({ id: "o1", status: "IN_REPAIR", currentBranchId: "b1" })
    const res = await photoUpload(new Request("https://app.invalid/api/workshop/o1/photos", { method: "POST", body: new FormData() }), params("o1"))
    expect(res.status).toBe(400)
  })

  it("POST en orden propia cerrada cae en la regla de cierre, no en la sucursal", async () => {
    mocks.auth.mockResolvedValue(restricted(["taller"]))
    q("repairOrder.findUnique").mockResolvedValue({ id: "o1", status: "DELIVERED", currentBranchId: "b1" })
    const res = await photoUpload(new Request("https://app.invalid/api/workshop/o1/photos", { method: "POST" }), params("o1"))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("cerrada") })
  })

  it("DELETE sobre orden ajena es 403; la propia llega a buscar la evidencia (404)", async () => {
    mocks.auth.mockResolvedValue(restricted(["taller"]))
    q("repairOrder.findUnique").mockResolvedValue({ id: "o1", status: "IN_REPAIR", currentBranchId: "b2" })
    const res = await photoDelete(new Request("https://app.invalid/api/workshop/o1/photos", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ photoId: "ph-1" }) }), params("o1"))
    expect(res.status).toBe(403)
    expect(q("repairPhoto.findFirst")).not.toHaveBeenCalled()

    q("repairOrder.findUnique").mockResolvedValue({ id: "o1", status: "IN_REPAIR", currentBranchId: "b1" })
    const ok = await photoDelete(new Request("https://app.invalid/api/workshop/o1/photos", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ photoId: "ph-1" }) }), params("o1"))
    expect(ok.status).toBe(404)
    expect(q("repairPhoto.findFirst")).toHaveBeenCalled()
  })
})

describe("admin/tickets/[tipo]/[id] — documentos de otra sucursal no se imprimen", () => {
  const page = (tipo: string, id: string) =>
    TicketPage({ params: Promise.resolve({ tipo, id }), searchParams: Promise.resolve({}) })

  it("venta de otra sucursal → notFound; la propia se imprime", async () => {
    mocks.auth.mockResolvedValue(restricted(["ventas"]))
    q("sale.findUnique").mockResolvedValue(saleRow("b2"))
    await expect(page("venta", "s-1")).rejects.toThrow("NEXT_NOT_FOUND")
    expect(mocks.notFound).toHaveBeenCalled()

    mocks.notFound.mockClear()
    q("sale.findUnique").mockResolvedValue(saleRow("b1"))
    await expect(page("venta", "s-1")).resolves.toBeTruthy()
    expect(mocks.notFound).not.toHaveBeenCalled()
  })

  it("reserva de otra sucursal → notFound", async () => {
    mocks.auth.mockResolvedValue(restricted(["clientes"]))
    q("reservation.findUnique").mockResolvedValue({ id: "res-1", branchId: "b2" })
    await expect(page("reserva", "res-1")).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("taller/cotizacion/reparacion: orden de otra sucursal → notFound", async () => {
    mocks.auth.mockResolvedValue(restricted(["taller"]))
    q("repairOrder.findUnique").mockResolvedValue({ id: "o1", currentBranchId: "b2" })
    for (const tipo of ["taller", "cotizacion", "reparacion"]) {
      await expect(page(tipo, "o1")).rejects.toThrow("NEXT_NOT_FOUND")
    }
  })

  it("documentos de taller exigen el módulo taller", async () => {
    mocks.auth.mockResolvedValue(restricted(["ventas"]))
    await expect(page("taller", "o1")).rejects.toThrow("NEXT_NOT_FOUND")
    expect(q("repairOrder.findUnique")).not.toHaveBeenCalled()
  })

  it("abono exige módulo clientes (el movimiento no tiene sucursal)", async () => {
    mocks.auth.mockResolvedValue(restricted(["ventas"]))
    await expect(page("abono", "cm-1")).rejects.toThrow("NEXT_NOT_FOUND")
    expect(q("creditMovement.findUnique")).not.toHaveBeenCalled()

    mocks.auth.mockResolvedValue(restricted(["clientes"]))
    q("creditMovement.findUnique").mockResolvedValue(null)
    await expect(page("abono", "cm-1")).rejects.toThrow("NEXT_NOT_FOUND")
    expect(q("creditMovement.findUnique")).toHaveBeenCalled()
  })
})

describe("admin/tickets/corte/[id] — corte de caja acotado", () => {
  const page = (id: string) => CorteTicketPage({ params: Promise.resolve({ id }) })

  it("exige el módulo caja antes de consultar", async () => {
    mocks.auth.mockResolvedValue(restricted(["ventas"]))
    await expect(page("reg-1")).rejects.toThrow("NEXT_NOT_FOUND")
    expect(q("cashRegister.findUnique")).not.toHaveBeenCalled()
  })

  it("corte de otra sucursal → notFound sin consultar pagos", async () => {
    mocks.auth.mockResolvedValue(restricted(["caja"]))
    q("cashRegister.findUnique").mockResolvedValue(registerRow("b2"))
    await expect(page("reg-1")).rejects.toThrow("NEXT_NOT_FOUND")
    expect(q("payment.groupBy")).not.toHaveBeenCalled()
  })

  it("corte propio imprime y el desglose por método incluye VOIDED", async () => {
    mocks.auth.mockResolvedValue(restricted(["caja"]))
    q("cashRegister.findUnique").mockResolvedValue(registerRow("b1"))
    q("payment.groupBy").mockResolvedValue([])
    await expect(page("reg-1")).resolves.toBeTruthy()
    // VOIDED +X y su reembolso REFUNDED −X se cancelan a 0 — sin VOIDED el
    // ticket imprimía un negativo fantasma (espejo de /api/caja).
    expect(q("payment.groupBy").mock.calls[0][0].where.status.in).toEqual(["CONFIRMED", "REFUNDED", "VOIDED"])
  })
})

describe("POST /api/supplier-payments — liquidar la cuenta es solo-admin", () => {
  const payload = { supplierId: "sup-1", amountCents: 5000, method: "CASH", idempotencyKey: "op:sup-0001" }

  it("empleado con inventario es 403 sin abrir transacción", async () => {
    mocks.auth.mockResolvedValue(restricted(["inventario"]))
    const res = await supplierPay(nx(post("https://app.invalid/api/supplier-payments", payload)))
    expect(res.status).toBe(403)
    expect(q("$transaction")).not.toHaveBeenCalled()
  })

  it("empleado sin restricción de módulos también es 403 (el rol manda)", async () => {
    mocks.auth.mockResolvedValue(staff("EMPLOYEE"))
    const res = await supplierPay(nx(post("https://app.invalid/api/supplier-payments", payload)))
    expect(res.status).toBe(403)
    expect(q("$transaction")).not.toHaveBeenCalled()
  })

  it("admin llega al dominio (proveedor inexistente → 404 controlado)", async () => {
    mocks.auth.mockResolvedValue(staff("ADMIN"))
    q("user.findUnique").mockResolvedValue({ ...txStaffUser, role: "ADMIN" })
    const res = await supplierPay(nx(post("https://app.invalid/api/supplier-payments", payload)))
    expect(res.status).toBe(404)
    expect(q("$transaction")).toHaveBeenCalled()
  })
})

describe("POST /api/notifications/read — marcar leídas exige el módulo", () => {
  it("sin módulo notificaciones es 403 sin tocar la tabla", async () => {
    mocks.auth.mockResolvedValue(restricted(["ventas"]))
    const res = await notificationsRead(nx(post("https://app.invalid/api/notifications/read", { all: true })))
    expect(res.status).toBe(403)
    expect(q("notification.findMany")).not.toHaveBeenCalled()
  })

  it("con el módulo marca solo la audiencia visible del empleado", async () => {
    mocks.auth.mockResolvedValue(staff("EMPLOYEE", { modules: ["notificaciones"], branches: ["b1"] }))
    q("notification.findMany").mockResolvedValue([])
    const res = await notificationsRead(nx(post("https://app.invalid/api/notifications/read", { all: true })))
    expect(res.status).toBe(200)
    expect(q("notification.findMany").mock.calls[0][0].where.audience).toBe("STAFF")
  })
})

describe("SSE /api/notifications/stream — rol y módulos revalidados", () => {
  const streamUser = (over: Partial<{ role: string; allowedModules: string[] }> = {}) => ({
    role: "EMPLOYEE", status: "APPROVED", password: "p", allowedModules: ["notificaciones"],
    businessId: "biz-test", business: { isActive: true }, ...over,
  })

  it("cierre del stream cuando el rol cambia tras conectar", async () => {
    mocks.auth.mockResolvedValue(staff("EMPLOYEE", { modules: ["notificaciones"] }))
    q("user.findUnique").mockResolvedValue(streamUser())
    const controller = new AbortController()
    const res = await notificationStream(nx(new Request("https://app.invalid/api/notifications/stream", { signal: controller.signal })))
    expect(res.status).toBe(200)
    const reader = res.body!.getReader()
    const first = await reader.read()
    expect(first.done).toBe(false) // evento "connected"

    // El usuario pierde el rol de staff: la conexión debe morir, no seguir
    // emitiendo con el snapshot congelado.
    q("user.findUnique").mockResolvedValue(streamUser({ role: "CUSTOMER" }))
    await sendNotificationToStaff({ type: "low_stock", title: "t", message: "m" }, "biz-test")
    expect((await reader.read()).done).toBe(true)
    controller.abort()
  })

  it("cierre del stream cuando le quitan el módulo notificaciones", async () => {
    mocks.auth.mockResolvedValue(staff("EMPLOYEE", { modules: ["notificaciones"] }))
    q("user.findUnique").mockResolvedValue(streamUser())
    const controller = new AbortController()
    const res = await notificationStream(nx(new Request("https://app.invalid/api/notifications/stream", { signal: controller.signal })))
    const reader = res.body!.getReader()
    await reader.read() // connected

    q("user.findUnique").mockResolvedValue(streamUser({ allowedModules: ["ventas"] }))
    await sendNotificationToStaff({ type: "low_stock", title: "t", message: "m" }, "biz-test")
    expect((await reader.read()).done).toBe(true)
    controller.abort()
  })

  it("snapshot vigente sigue recibiendo el broadcast", async () => {
    mocks.auth.mockResolvedValue(staff("EMPLOYEE", { modules: ["notificaciones"] }))
    q("user.findUnique").mockResolvedValue(streamUser())
    const controller = new AbortController()
    const res = await notificationStream(nx(new Request("https://app.invalid/api/notifications/stream", { signal: controller.signal })))
    const reader = res.body!.getReader()
    await reader.read() // connected

    await sendNotificationToStaff({ type: "low_stock", title: "t", message: "m" }, "biz-test")
    const chunk = await reader.read()
    expect(chunk.done).toBe(false)
    expect(new TextDecoder().decode(chunk.value)).toContain("low_stock")
    controller.abort()
  })
})
