import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * DELETE /api/products/[id] — borrado de producto:
 *
 * - El guard de reservas activas usa el set completo del dominio
 *   (PENDING, PENDING_PAYMENT, DEPOSIT_VERIFIED, APPROVED): una reserva viva
 *   a crédito o con anticipo bloquea con 409 — borrarla dejaría la deuda del
 *   cliente apuntando a una fila inexistente.
 * - Con existencias (Product.stock > 0) bloquea con 409 salvo ?force=true:
 *   BranchStock es onDelete: Cascade y borrar con stock quema el costo de lo
 *   que queda en anaqueles. Force lo permite y el stock retirado queda
 *   asentado en la bitácora (changes.stock before→0).
 * - CON HISTORIAL (cualquier InventoryMovement o cualquier Reservation, viva
 *   o terminal) el delete se convierte en DESACTIVACIÓN: isActive=false y
 *   el ledger queda intacto — la purga de movimientos/reservas destruía la
 *   historia de existencias. ?force solo salta la guarda de stock, nunca
 *   autoriza quemar el ledger.
 * - Solo un producto virgen (sin un solo movimiento ni reserva) se borra
 *   físicamente: no hay historial que preservar.
 * - El stock se RE-LEE dentro de la tx serializable: si entró mercancía
 *   entre la primera lectura y el commit, la re-lectura ve la cifra vigente
 *   y bloquea igual. El conteo de historial también va dentro: una reserva
 *   nacida a mitad ya no cae en cascade silencioso.
 * - Una FK Restrict (SaleItem, MarketplaceRequest…) aborta con 409 pidiendo
 *   desactivar el producto en lugar de borrarlo.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  productFindUnique: vi.fn(),
  productFindUniqueOrThrowTx: vi.fn(),
  productUpdate: vi.fn(),
  productDelete: vi.fn(),
  productModelDeleteMany: vi.fn(),
  inventoryMovementCount: vi.fn(),
  // reservation.count corre dos veces por delete: primero el re-chequeo de
  // activas dentro de la tx, luego el total (historial).
  reservationCount: vi.fn(),
  auditCreate: vi.fn(),
  userFindUnique: vi.fn(),
  transaction: vi.fn(),
  unlink: vi.fn(),
  realpath: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
// Bitácora real sobre el auditEvent mockeado; la alerta Telegram queda fuera.
vi.mock("@/lib/audit-alerts", () => ({
  ALERTED_ACTIONS: new Set(["PRODUCT_DELETE"]),
  alertSensitiveAudit: vi.fn(async () => {}),
  escapeAlertHtml: (v: string) => v,
  notifyOwner: vi.fn(async () => false),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findUnique: mocks.productFindUnique },
    auditEvent: { create: mocks.auditCreate },
    user: { findUnique: mocks.userFindUnique },
    $transaction: mocks.transaction,
  },
}))
// El DELETE desvincula las fotos /uploads/products/* del disco SOLO en el
// borrado físico: unlink queda mockeado para verificar qué rutas se borran
// (y que en desactivación no se toca ninguna — el producto sigue vivo).
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return { ...actual, promises: { ...actual.promises, unlink: mocks.unlink, realpath: mocks.realpath } }
})

import { DELETE } from "@/app/api/products/[id]/route"

// El tx que la ruta recibe dentro de $transaction.
const tx = {
  productModel: { deleteMany: mocks.productModelDeleteMany },
  inventoryMovement: { count: mocks.inventoryMovementCount },
  reservation: { count: mocks.reservationCount },
  product: {
    delete: mocks.productDelete,
    update: mocks.productUpdate,
    findUniqueOrThrow: mocks.productFindUniqueOrThrowTx,
  },
}

const session = (id = "u-admin", role = "ADMIN", extra: Record<string, unknown> = {}) => ({
  user: { id, role, status: "APPROVED", businessId: "biz-1", ...extra },
})

const productRow = (reservations: unknown[] = [], images: string[] = [], stock = 0) => ({
  id: "p1",
  name: "Pantalla iPhone 11",
  retailPrice: 1200,
  isActive: true,
  stock,
  images,
  reservations,
})

const del = (id = "p1", force = false) =>
  DELETE(
    new NextRequest(`https://app.invalid/api/products/${id}${force ? "?force=true" : ""}`, { method: "DELETE" }),
    { params: Promise.resolve({ id }) },
  )

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(session())
  mocks.productFindUnique.mockResolvedValue(productRow())
  mocks.productFindUniqueOrThrowTx.mockResolvedValue({ stock: 0 })
  mocks.reservationCount.mockResolvedValue(0)
  mocks.inventoryMovementCount.mockResolvedValue(0)
  mocks.productModelDeleteMany.mockResolvedValue({ count: 0 })
  mocks.productUpdate.mockResolvedValue({})
  mocks.productDelete.mockResolvedValue({})
  mocks.auditCreate.mockResolvedValue({})
  mocks.unlink.mockResolvedValue(undefined)
  mocks.realpath.mockImplementation(async (p: string) => p)
  mocks.transaction.mockImplementation((work: (t: unknown) => unknown) => work(tx))
})

describe("acceso", () => {
  it("rechaza sin sesión y a empleados sin el módulo inventario", async () => {
    for (const s of [
      null,
      session("u1", "EMPLOYEE", { allowedModules: ["caja"] }),
      session("u2", "CUSTOMER"),
    ]) {
      mocks.auth.mockResolvedValue(s)
      const res = await del()
      expect([401, 403]).toContain(res.status)
    }
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})

describe("reservas activas", () => {
  it.each(["PENDING", "PENDING_PAYMENT", "DEPOSIT_VERIFIED", "APPROVED"])(
    "409 cuando el producto tiene una reserva %s (p. ej. a crédito)",
    async (status) => {
      mocks.productFindUnique.mockResolvedValue(
        productRow([{ id: "r1", status, paymentMethod: "CREDIT" }])
      )
      const res = await del()
      expect(res.status).toBe(409)
      const json = await res.json()
      expect(json.error).toContain("reservas activas")
      expect(json.error).toContain("desactiva")
      // Ni la tx ni el delete corrieron: reserva y deuda quedan intactas.
      expect(mocks.transaction).not.toHaveBeenCalled()
      expect(mocks.productDelete).not.toHaveBeenCalled()
      expect(mocks.productUpdate).not.toHaveBeenCalled()
    }
  )

  it("la consulta filtra por TODO el set de reservas activas del dominio", async () => {
    await del()
    const include = mocks.productFindUnique.mock.calls[0][0].include.reservations.where.status.in
    expect(include).toEqual(
      expect.arrayContaining(["PENDING", "PENDING_PAYMENT", "DEPOSIT_VERIFIED", "APPROVED"])
    )
  })

  it("re-verifica dentro de la tx: una reserva creada durante el delete bloquea con 409", async () => {
    mocks.reservationCount.mockResolvedValueOnce(1)
    const res = await del()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain("reservas activas")
    // La tx abortó: no se borró ni se desactivó el producto.
    expect(mocks.productDelete).not.toHaveBeenCalled()
    expect(mocks.productUpdate).not.toHaveBeenCalled()
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })
})

describe("guard de existencias", () => {
  it("con stock > 0 responde 409 y pide ajustar a 0 antes de eliminar", async () => {
    mocks.productFindUnique.mockResolvedValue(productRow([], [], 7))
    const res = await del()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(
      "El producto tiene 7 en existencia; ajusta el stock a 0 antes de eliminar"
    )
    // Ni la tx ni el delete corrieron: la mercancía y su costo quedan vivos.
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.productDelete).not.toHaveBeenCalled()
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })

  it("re-lee el stock dentro de la tx: mercancía que entró a mitad bloquea con 409", async () => {
    // La lectura previa vio stock 0, pero dentro de la tx la fila ya marca 4
    // (llegó mercancía entre ambas lecturas): sin force sigue siendo 409.
    mocks.productFindUniqueOrThrowTx.mockResolvedValue({ stock: 4 })
    const res = await del()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(
      "El producto tiene 4 en existencia; ajusta el stock a 0 antes de eliminar"
    )
    expect(mocks.productDelete).not.toHaveBeenCalled()
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })

  it("?force=true borra con existencias SOLO si el producto está virgen", async () => {
    // stock 5 sin historial (conteos en 0): el borrado físico sigue vivo y el
    // stock retirado se asienta en la bitácora.
    mocks.productFindUnique.mockResolvedValue(productRow([], [], 5))
    mocks.productFindUniqueOrThrowTx.mockResolvedValue({ stock: 5 })
    const res = await del("p1", true)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, deactivated: false })

    const audit = mocks.auditCreate.mock.calls[0][0].data
    expect(audit.action).toBe("PRODUCT_DELETE")
    expect(audit.changes).toEqual({ stock: { before: 5, after: 0 } })
    expect(audit.summary).toContain("5 en existencia")
    expect(mocks.productDelete).toHaveBeenCalledWith({ where: { id: "p1", businessId: "biz-1" } })
  })

  it("?force=true con stock 0 borra normal y la bitácora no lleva changes", async () => {
    const res = await del("p1", true)
    expect(res.status).toBe(200)
    const audit = mocks.auditCreate.mock.calls[0][0].data
    expect(audit.action).toBe("PRODUCT_DELETE")
    expect(audit.changes).toBeUndefined()
  })

  it("?force con existencias E HISTORIAL desactiva: force nunca quema el ledger", async () => {
    mocks.productFindUnique.mockResolvedValue(productRow([], [], 5))
    mocks.productFindUniqueOrThrowTx.mockResolvedValue({ stock: 5 })
    mocks.inventoryMovementCount.mockResolvedValue(3)
    const res = await del("p1", true)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, deactivated: true })
    // La mercancía y sus movimientos quedan registrados: nada se borra.
    expect(mocks.productDelete).not.toHaveBeenCalled()
    expect(mocks.productUpdate).toHaveBeenCalledWith({
      where: { id: "p1", businessId: "biz-1" },
      data: { isActive: false },
    })
    const audit = mocks.auditCreate.mock.calls[0][0].data
    expect(audit.action).toBe("PRODUCT_UPDATE")
    expect(audit.summary).toContain("conserva su historial")
    expect(audit.summary).toContain("5 en existencia")
  })
})

describe("historial → desactivación en lugar de borrado", () => {
  it("producto con movimientos de inventario queda isActive=false y el ledger intacto", async () => {
    mocks.inventoryMovementCount.mockResolvedValue(4)
    const res = await del()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, deactivated: true })

    expect(mocks.productUpdate).toHaveBeenCalledWith({
      where: { id: "p1", businessId: "biz-1" },
      data: { isActive: false },
    })
    // Nada de purga: ni producto, ni modelos, ni movimientos.
    expect(mocks.productDelete).not.toHaveBeenCalled()
    expect(mocks.productModelDeleteMany).not.toHaveBeenCalled()
    expect(mocks.unlink).not.toHaveBeenCalled() // conserva sus fotos

    const audit = mocks.auditCreate.mock.calls[0][0].data
    expect(audit).toMatchObject({
      businessId: "biz-1",
      actorId: "u-admin",
      action: "PRODUCT_UPDATE",
      entity: "product",
      entityId: "p1",
      entityName: "Pantalla iPhone 11",
      changes: { activo: { before: true, after: false } },
    })
    expect(audit.summary).toContain("Desactivó")
    expect(audit.summary).toContain("conserva su historial")
  })

  it("producto con reservas terminales también se desactiva (la historia se conserva)", async () => {
    // Primera llamada a reservation.count (activas) = 0; segunda (total) = 2.
    mocks.reservationCount
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(2)
    const res = await del()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, deactivated: true })
    expect(mocks.productUpdate).toHaveBeenCalledWith({
      where: { id: "p1", businessId: "biz-1" },
      data: { isActive: false },
    })
    expect(mocks.productDelete).not.toHaveBeenCalled()
  })
})

describe("borrado físico (producto virgen)", () => {
  it("sin movimientos ni reservas borra el producto y sus ligas de modelos", async () => {
    const res = await del()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, deactivated: false })

    expect(mocks.productModelDeleteMany).toHaveBeenCalledTimes(1)
    expect(mocks.productDelete).toHaveBeenCalledWith({ where: { id: "p1", businessId: "biz-1" } })
    expect(mocks.productUpdate).not.toHaveBeenCalled()

    // Bitácora PRODUCT_DELETE con el nombre del producto.
    const audit = mocks.auditCreate.mock.calls[0][0].data
    expect(audit).toMatchObject({
      businessId: "biz-1",
      actorId: "u-admin",
      action: "PRODUCT_DELETE",
      entity: "product",
      entityId: "p1",
      entityName: "Pantalla iPhone 11",
    })
  })
})

describe("limpieza de archivos de imagen", () => {
  it("desvincula del disco las fotos /uploads/products/* tras el borrado físico", async () => {
    mocks.productFindUnique.mockResolvedValue(
      productRow([], ["/uploads/products/a.jpg", "/uploads/products/b.webp"])
    )
    const res = await del()
    expect(res.status).toBe(200)

    expect(mocks.unlink).toHaveBeenCalledTimes(2)
    const paths = mocks.unlink.mock.calls.map(c => String(c[0]))
    for (const p of paths) {
      expect(p.replaceAll("\\", "/")).toContain("public/uploads/products/")
    }
    expect(paths.some(p => p.endsWith("a.jpg"))).toBe(true)
    expect(paths.some(p => p.endsWith("b.webp"))).toBe(true)
    // El archivo se borra solo después de que la fila quedó eliminada.
    expect(mocks.unlink.mock.invocationCallOrder[0])
      .toBeGreaterThan(mocks.productDelete.mock.invocationCallOrder[0])
  })

  it("en desactivación NO borra las fotos: el producto sigue vivo con ellas", async () => {
    mocks.inventoryMovementCount.mockResolvedValue(1)
    mocks.productFindUnique.mockResolvedValue(productRow([], ["/uploads/products/a.jpg"]))
    const res = await del()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ deactivated: true })
    expect(mocks.unlink).not.toHaveBeenCalled()
  })

  it("solo el prefijo /uploads/products/ con nombre plano se borra (sin traversal ni externos)", async () => {
    mocks.productFindUnique.mockResolvedValue(
      productRow([], [
        "/uploads/products/ok.png",
        "https://cdn.example.com/x.jpg",
        "/uploads/products/../secret.txt",
        "/uploads/products/subdir/y.jpg",
        "/uploads/logos/z.png",
      ])
    )
    const res = await del()
    expect(res.status).toBe(200)
    expect(mocks.unlink).toHaveBeenCalledTimes(1)
    expect(String(mocks.unlink.mock.calls[0][0])).toMatch(/ok\.png$/)
  })

  it("un archivo ausente o un error de disco no tumban el delete", async () => {
    mocks.unlink.mockRejectedValue(Object.assign(new Error("no file"), { code: "ENOENT" }))
    mocks.productFindUnique.mockResolvedValue(productRow([], ["/uploads/products/a.jpg"]))
    const res = await del()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, deactivated: false })
  })
})

describe("llaves foráneas Restrict", () => {
  it.each(["P2003", "P2014"])(
    "%s (ventas/solicitudes asociadas) responde 409 pidiendo desactivar",
    async (code) => {
      mocks.productDelete.mockRejectedValue(Object.assign(new Error("FK violation"), { code }))
      const res = await del()
      expect(res.status).toBe(409)
      const json = await res.json()
      expect(json.error).toContain("ventas o solicitudes")
      expect(json.error).toContain("Desactívalo")
      // La tx se revirtió completa; no queda rastro de un delete a medias.
      expect(mocks.auditCreate).not.toHaveBeenCalled()
    }
  )

  it("un error que no es de FK sigue siendo 500", async () => {
    mocks.productDelete.mockRejectedValue(new Error("connection lost"))
    const res = await del()
    expect(res.status).toBe(500)
  })
})
