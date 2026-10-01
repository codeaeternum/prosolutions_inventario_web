import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { getPlatformBusinessDetail } from "@/lib/platform"

type Params = { params: Promise<{ id: string }> }

const patchSchema = z.object({
  isActive: z.boolean(),
})

/**
 * GET /api/platform/businesses/[id] — Consola Reficio (solo superadmin).
 *
 * Detalle operativo de una empresa: datos, conteos, métricas, últimas 5
 * órdenes/ventas y el equipo de usuarios (sin contraseñas).
 */
export async function GET(_req: Request, { params }: Params) {
  const auth = await requireSuperAdmin()
  if (auth.error) return auth.error

  const { id } = await params
  try {
    const business = await getPlatformBusinessDetail(id)
    if (!business) {
      return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 })
    }
    return NextResponse.json(
      { business },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    console.error("[platform] Error consultando empresa:", error)
    return NextResponse.json(
      { error: "Error al consultar la empresa" },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/platform/businesses/[id] — body { isActive: boolean }.
 *
 * Suspender (isActive=false) no borra nada: la vitrina pública del slug deja
 * de resolver (resolvePublicSlug exige isActive) y el login de sus usuarios
 * queda bloqueado — las sesiones vivas se revocan en el callback jwt, que
 * verifica business.isActive en cada request. Reactivar lo revierte todo.
 */
export async function PATCH(req: Request, { params }: Params) {
  const auth = await requireSuperAdmin()
  if (auth.error) return auth.error

  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
  }

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
  }

  try {
    const existing = await prisma.business.findUnique({ where: { id }, select: { id: true } })
    if (!existing) {
      return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 })
    }

    const business = await prisma.business.update({
      where: { id },
      data: { isActive: parsed.data.isActive },
      select: { id: true, name: true, slug: true, isActive: true, updatedAt: true },
    })

    return NextResponse.json({ business })
  } catch (error) {
    console.error("[platform] Error actualizando empresa:", error)
    return NextResponse.json(
      { error: "Error al actualizar la empresa" },
      { status: 500 }
    )
  }
}

/**
 * Tablas que delatan actividad real del tenant: cualquier fila hace que la
 * empresa ya no sea "vacía" y el borrado se rechaza (409). Lo sembrado al
 * registrarse (User, SystemSettings, Branch, WorkshopService) NO va aquí —
 * esas filas siempre existen y se borran en la tx.
 */
const BLOCKING_MODELS: ReadonlyArray<{ accessor: string; label: string }> = [
  { accessor: "category", label: "categorías" },
  { accessor: "brand", label: "marcas" },
  { accessor: "model", label: "modelos" },
  { accessor: "deviceModel", label: "modelos de dispositivo" },
  { accessor: "product", label: "productos" },
  { accessor: "productModel", label: "compatibilidades" },
  { accessor: "priceHistory", label: "historial de precios" },
  { accessor: "branchStock", label: "stock por sucursal" },
  { accessor: "inventoryMovement", label: "movimientos de inventario" },
  { accessor: "inventoryCount", label: "conteos físicos" },
  { accessor: "inventoryCountItem", label: "partidas de conteo" },
  { accessor: "sale", label: "ventas" },
  { accessor: "saleItem", label: "partidas de venta" },
  { accessor: "payment", label: "pagos" },
  { accessor: "reservation", label: "reservaciones" },
  { accessor: "creditMovement", label: "movimientos de crédito" },
  { accessor: "cashRegister", label: "cajas" },
  { accessor: "cashMovement", label: "movimientos de caja" },
  { accessor: "cashRequest", label: "solicitudes de efectivo" },
  { accessor: "repairOrder", label: "órdenes de servicio" },
  { accessor: "repairPart", label: "piezas de reparación" },
  { accessor: "repairEvent", label: "eventos de reparación" },
  { accessor: "repairPhoto", label: "evidencia fotográfica" },
  { accessor: "marketplaceRequest", label: "solicitudes del mercado" },
  { accessor: "encargo", label: "encargos" },
  { accessor: "supplier", label: "proveedores" },
  { accessor: "purchase", label: "compras" },
  { accessor: "purchaseItem", label: "partidas de compra" },
  { accessor: "supplierPayment", label: "pagos a proveedor" },
  { accessor: "shoppingItem", label: "lista de compras" },
  { accessor: "directoryEvent", label: "actividad del directorio" },
]

type CountDelegate = { count: (args: { where: { businessId: string } }) => Promise<number> }

function isFkViolation(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code
  // P2014 (delete con relación requerida con filas) y P2003 (FK constraint).
  return code === "P2014" || code === "P2003"
}

/**
 * DELETE /api/platform/businesses/[id] — borra una empresa VACÍA (altas de
 * prueba/broma como las que ensuciaban el registro). No hay soft-delete:
 * si tiene cualquier dato operativo responde 409 — para eso está suspender.
 * En la tx se eliminan primero las filas semilla/desechables; cualquier
 * fila Restrict no contemplada aborta con 409 en vez de dejar medias.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const auth = await requireSuperAdmin()
  if (auth.error) return auth.error

  const { id } = await params
  const business = await prisma.business.findUnique({
    where: { id },
    select: { id: true, name: true, slug: true },
  })
  if (!business) {
    return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 })
  }

  const db = prisma as unknown as Record<string, CountDelegate>
  const counts = await Promise.all(
    BLOCKING_MODELS.map(async (m) => ({
      ...m,
      n: await db[m.accessor].count({ where: { businessId: id } }),
    }))
  )
  const blockers = counts.filter((c) => c.n > 0)
  if (blockers.length > 0) {
    const detail = blockers.map((b) => `${b.n} ${b.label}`).join(", ")
    return NextResponse.json(
      {
        error: `No se puede eliminar: tiene ${detail}. Suspéndela en su lugar.`,
        blockers: Object.fromEntries(blockers.map((b) => [b.accessor, b.n])),
      },
      { status: 409 }
    )
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Orden: primero tablas con FK Restrict a business Y a user/actor;
      // VerificationCode/DeviceModel/Notification/NotificationRead caen
      // solas por Cascade (business o user).
      await tx.businessOperation.deleteMany({ where: { businessId: id } })
      await tx.auditEvent.deleteMany({ where: { businessId: id } })
      await tx.pushSubscription.deleteMany({ where: { businessId: id } })
      await tx.settings.deleteMany({ where: { businessId: id } })
      await tx.systemSettings.deleteMany({ where: { businessId: id } })
      await tx.workshopService.deleteMany({ where: { businessId: id } })
      await tx.user.deleteMany({ where: { businessId: id } })
      await tx.branch.deleteMany({ where: { businessId: id } })
      await tx.business.delete({ where: { id } })
    })
  } catch (error) {
    if (isFkViolation(error)) {
      return NextResponse.json(
        { error: "La empresa aún tiene datos vinculados que impiden borrarla. Suspéndela en su lugar." },
        { status: 409 }
      )
    }
    console.error("[platform] Error eliminando empresa:", error)
    return NextResponse.json(
      { error: "Error al eliminar la empresa" },
      { status: 500 }
    )
  }

  console.warn(`[platform] Empresa eliminada: ${business.name} (${business.slug})`)
  return NextResponse.json({ ok: true, deleted: business.slug })
}
