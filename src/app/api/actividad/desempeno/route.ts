import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { businessFailure } from "@/lib/domain/http"

interface UsuarioDesempeno {
  id: string
  name: string
  role: string
  jobTitle: string | null
  /** Importe vendido en pesos (Sale.total, solo status COMPLETED). */
  ventas: number
  /** Número de documentos de venta cobrados. */
  ventasCount: number
  /** Piezas vendidas netas (SaleItem.quantity − returnedQuantity). */
  piezasVendidas: number
  /** OTs que entraron en el periodo a su nombre (las registró o se le asignaron). */
  ordenesCreadas: number
  /** OTs entregadas en el periodo donde participó (técnico o quien entregó). */
  ordenesEntregadas: number
  /** Movimientos de inventario ajenos a ventas (mermas, ajustes, traspasos, entradas). */
  movimientos: number
  /** AuditEvent + BusinessOperation — todo lo que dejó huella en el sistema. */
  acciones: number
}

/**
 * GET /api/actividad/desempeno?dias=7|30|90 — producción por empleado en el
 * periodo: qué vendió, qué reparó/entregó y cuánto movió en inventario. La
 * lectura del dueño es "¿qué produjo Kevin esta semana?" en una sola tabla.
 *
 * Atribución:
 * - Ventas → Sale.sellerId (relación "SaleSeller"); solo COMPLETED cuenta,
 *   igual que /api/reports (DRAFT/OPEN/VOIDED no son ingreso).
 * - OTs → cada orden acredita a TODOS sus responsables: "creadas" suma a
 *   createdById (recepción que capturó) y assignedToId (técnico que la
 *   recibió); "entregadas" (status DELIVERED con updatedAt en el periodo —
 *   no hay deliveredAt, updatedAt es el proxy) suma al técnico asignado y a
 *   deliveredById, quien la entregó en mostrador. Si nadie quedó asignado,
 *   el crédito cae en quien la registró.
 * - Movimientos → InventoryMovement.userId con saleId null (los ligados a
 *   venta ya cuentan en "ventas"/"piezas").
 * - Acciones → AuditEvent.actorId + BusinessOperation.actorId, mismas
 *   fuentes que lib/turnos.
 *
 * Solo ADMIN. Incluye staff sin actividad (ceros visibles: "Kevin no vendió").
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const businessId = businessIdOf(getSession(auth)!)

    const diasParam = Number(new URL(request.url).searchParams.get("dias"))
    const dias = diasParam === 7 || diasParam === 90 ? diasParam : 30
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000)

    const [users, sales, orders, movementGroups, auditGroups, opGroups] = await Promise.all([
      // Padrón del negocio completo: staff aparece aunque no haya producido,
      // y los actorId que ya no sean staff (bajas, WORKSHOP) conservan nombre.
      prisma.user.findMany({
        where: { businessId, status: "APPROVED" },
        select: { id: true, name: true, role: true, jobTitle: true },
      }),
      prisma.sale.findMany({
        where: { businessId, status: "COMPLETED", createdAt: { gte: desde } },
        select: {
          sellerId: true,
          total: true,
          items: { select: { quantity: true, returnedQuantity: true } },
        },
      }),
      // OTs con actividad en el periodo: creadas en el rango o entregadas en
      // él (status DELIVERED + updatedAt como fecha de entrega).
      prisma.repairOrder.findMany({
        where: {
          businessId,
          OR: [
            { createdAt: { gte: desde } },
            { status: "DELIVERED", updatedAt: { gte: desde } },
          ],
        },
        select: {
          createdById: true,
          assignedToId: true,
          deliveredById: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.inventoryMovement.groupBy({
        by: ["userId"],
        where: { businessId, saleId: null, userId: { not: null }, createdAt: { gte: desde } },
        _count: { _all: true },
      }),
      prisma.auditEvent.groupBy({
        by: ["actorId"],
        where: { businessId, createdAt: { gte: desde } },
        _count: { _all: true },
      }),
      prisma.businessOperation.groupBy({
        by: ["actorId"],
        where: { businessId, createdAt: { gte: desde } },
        _count: { _all: true },
      }),
    ])

    type Stats = Omit<UsuarioDesempeno, "id" | "name" | "role" | "jobTitle">
    const stats = new Map<string, Stats>()
    const of = (id: string): Stats => {
      let s = stats.get(id)
      if (!s) {
        s = { ventas: 0, ventasCount: 0, piezasVendidas: 0, ordenesCreadas: 0, ordenesEntregadas: 0, movimientos: 0, acciones: 0 }
        stats.set(id, s)
      }
      return s
    }

    for (const s of sales) {
      const st = of(s.sellerId)
      st.ventas += s.total
      st.ventasCount++
      st.piezasVendidas += s.items.reduce((n, i) => n + Math.max(0, i.quantity - i.returnedQuantity), 0)
    }

    for (const o of orders) {
      if (o.createdAt >= desde) {
        // Recepción que capturó + técnico que la recibió en su carga.
        for (const id of new Set([o.createdById, o.assignedToId])) {
          if (id) of(id).ordenesCreadas++
        }
      }
      if (o.status === "DELIVERED" && o.updatedAt >= desde) {
        // Técnico responsable + mostrador que entregó; sin ambos, el capturista.
        const ids = new Set([o.assignedToId, o.deliveredById].filter((x): x is string => Boolean(x)))
        if (ids.size === 0) ids.add(o.createdById)
        for (const id of ids) of(id).ordenesEntregadas++
      }
    }

    for (const g of movementGroups) {
      if (g.userId) of(g.userId).movimientos += g._count._all
    }
    for (const g of auditGroups) of(g.actorId).acciones += g._count._all
    for (const g of opGroups) of(g.actorId).acciones += g._count._all

    const usuarios: UsuarioDesempeno[] = users
      .filter(u => {
        // Staff siempre aparece; un no-staff (baja/WORKSHOP) solo si produjo algo.
        if (u.role === "ADMIN" || u.role === "EMPLOYEE") return true
        const s = stats.get(u.id)
        return s ? s.acciones + s.ventasCount + s.ordenesCreadas + s.movimientos > 0 : false
      })
      .map(u => ({ id: u.id, name: u.name, role: u.role, jobTitle: u.jobTitle, ...(stats.get(u.id) ?? of(u.id)) }))
      .sort((a, b) => b.ventas - a.ventas || b.acciones - a.acciones || a.name.localeCompare(b.name, "es"))

    return NextResponse.json(
      { dias, desde: desde.toISOString(), usuarios },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return businessFailure(error)
  }
}
