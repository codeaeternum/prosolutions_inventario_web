import { NextResponse, type NextRequest } from "next/server"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { paginated } from "@/lib/api-pagination"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"
import type { ReservationStatus, SaleStatus } from "@prisma/client"

/**
 * Pedidos del cliente: feed unificado de la demanda registrada.
 *
 * Mezcla tres fuentes del tenant en una sola tabla ordenada por createdAt:
 *   - ENCARGO             pieza que el cliente pidió y no había en stock
 *   - APARTADO_WEB        reserva del catálogo público (modelo Reservation)
 *   - APARTADO_MOSTRADOR  venta kind=LAYAWAY creada en la terminal POS
 *
 * Filtros: ?tipo=ENCARGO|APARTADO_WEB|APARTADO_MOSTRADOR, ?status=<estado
 * crudo de la fuente>, ?page=, ?limit=. Cada fuente filtra solo por los
 * estados que le pertenecen; un status ajeno a su dominio la deja vacía.
 */

const TIPOS = ["ENCARGO", "APARTADO_WEB", "APARTADO_MOSTRADOR"] as const
type Tipo = (typeof TIPOS)[number]

const ENCARGO_STATUSES = new Set(["PENDING", "ORDERED", "READY", "DELIVERED", "CANCELLED"])
const RESERVATION_STATUSES = new Set([
  "PENDING",
  "PENDING_PAYMENT",
  "DEPOSIT_VERIFIED",
  "APPROVED",
  "REJECTED",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
])
const SALE_STATUSES = new Set(["DRAFT", "OPEN", "COMPLETED", "VOIDED"])

interface PedidoRow {
  tipo: Tipo
  id: string
  folio: string | null
  cliente: string | null
  detalle: string
  /** Total del documento; en encargos es el precio cotizado (null si aún no se cotiza). */
  monto: number | null
  /** Anticipo/depósito confirmado en pesos. */
  anticipo: number
  status: string
  createdAt: Date
  branchId: string | null
  href: string
}

// GET /api/pedidos — feed paginado para la pestaña Pedidos del hub de Clientes.
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModule("clientes")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)
    // Empleado con sucursales asignadas: las tres fuentes del feed se recortan
    // a las suyas (encargos, apartados web y apartados de mostrador).
    const allowed = session.user.role === "ADMIN" ? null : session.user.allowedBranchIds
    const branchScope = allowed?.length ? { branchId: { in: allowed } } : {}

    const params = new URL(request.url).searchParams
    const tipo = params.get("tipo")
    if (tipo && !(TIPOS as readonly string[]).includes(tipo)) {
      return NextResponse.json({ error: "Tipo inválido" }, { status: 400 })
    }
    const status = params.get("status")?.trim().toUpperCase() || null
    const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(params.get("limit") ?? "20", 10) || 20))

    const wantEncargos = (!tipo || tipo === "ENCARGO") && (!status || ENCARGO_STATUSES.has(status))
    const wantReservas = (!tipo || tipo === "APARTADO_WEB") && (!status || RESERVATION_STATUSES.has(status))
    const wantLayaways = (!tipo || tipo === "APARTADO_MOSTRADOR") && (!status || SALE_STATUSES.has(status))

    // Para fusionar ordenado por createdAt cada fuente aporta hasta page*limit
    // filas (suficiente para llenar la página pedida); el total exacto sale
    // de los counts. status solo se aplica donde pertenece al dominio.
    const take = page * limit

    const [encargos, reservas, layaways, encargoCount, reservaCount, layawayCount] = await Promise.all([
      wantEncargos
        ? prisma.encargo.findMany({
            where: { businessId, ...branchScope, ...(status ? { status } : {}) },
            select: {
              id: true,
              description: true,
              quantity: true,
              deposit: true,
              priceQuoted: true,
              status: true,
              branchId: true,
              createdAt: true,
              customer: { select: { name: true } },
            },
            orderBy: { createdAt: "desc" },
            take,
          })
        : Promise.resolve([]),
      wantReservas
        ? prisma.reservation.findMany({
            where: { businessId, ...branchScope, ...(status ? { status: status as ReservationStatus } : {}) },
            select: {
              id: true,
              qrCode: true,
              quantity: true,
              totalPrice: true,
              depositAmount: true,
              depositPaid: true,
              status: true,
              branchId: true,
              createdAt: true,
              user: { select: { name: true } },
              product: { select: { name: true } },
            },
            orderBy: { createdAt: "desc" },
            take,
          })
        : Promise.resolve([]),
      wantLayaways
        ? prisma.sale.findMany({
            where: { businessId, kind: "LAYAWAY", ...branchScope, ...(status ? { status: status as SaleStatus } : {}) },
            select: {
              id: true,
              number: true,
              total: true,
              status: true,
              branchId: true,
              createdAt: true,
              customer: { select: { name: true } },
              items: { select: { quantity: true, product: { select: { name: true } } } },
              payments: { where: { status: "CONFIRMED" }, select: { amount: true } },
            },
            orderBy: { createdAt: "desc" },
            take,
          })
        : Promise.resolve([]),
      wantEncargos ? prisma.encargo.count({ where: { businessId, ...branchScope, ...(status ? { status } : {}) } }) : Promise.resolve(0),
      wantReservas
        ? prisma.reservation.count({ where: { businessId, ...branchScope, ...(status ? { status: status as ReservationStatus } : {}) } })
        : Promise.resolve(0),
      wantLayaways
        ? prisma.sale.count({ where: { businessId, kind: "LAYAWAY", ...branchScope, ...(status ? { status: status as SaleStatus } : {}) } })
        : Promise.resolve(0),
    ])

    const encargoRows: PedidoRow[] = encargos.map((e) => ({
      tipo: "ENCARGO",
      id: e.id,
      folio: null,
      cliente: e.customer?.name ?? null,
      detalle: `${e.quantity}× ${e.description}`,
      monto: e.priceQuoted ?? null,
      anticipo: e.deposit,
      status: e.status,
      createdAt: e.createdAt,
      branchId: e.branchId,
      href: "/admin/inventario?tab=encargos",
    }))

    const reservaRows: PedidoRow[] = reservas.map((r) => ({
      tipo: "APARTADO_WEB",
      id: r.id,
      folio: r.qrCode.slice(-8).toUpperCase(),
      cliente: r.user.name,
      detalle: `${r.quantity}× ${r.product.name}`,
      monto: r.totalPrice,
      anticipo: r.depositPaid ? r.depositAmount ?? 0 : 0,
      status: r.status,
      createdAt: r.createdAt,
      branchId: r.branchId,
      // La ficha de verificación (/verificar) acepta id o qrCode y concentra
      // las acciones de validar pago / entregar.
      href: `/verificar/${r.id}`,
    }))

    const layawayRows: PedidoRow[] = layaways.map((s) => ({
      tipo: "APARTADO_MOSTRADOR",
      id: s.id,
      folio: `A-${String(s.number).padStart(6, "0")}`,
      cliente: s.customer?.name ?? null,
      detalle: s.items.map((i) => `${i.quantity}× ${i.product.name}`).join(", "),
      monto: s.total,
      anticipo: s.payments.reduce((sum, p) => sum + p.amount, 0),
      status: s.status,
      createdAt: s.createdAt,
      branchId: s.branchId,
      // El POS abre el cajón de apartados con ?apartados=1.
      href: "/admin/ventas?apartados=1",
    }))

    const rows = [...encargoRows, ...reservaRows, ...layawayRows]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice((page - 1) * limit, page * limit)

    const total = encargoCount + reservaCount + layawayCount
    return NextResponse.json(paginated(rows, total, page, limit), {
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    return businessFailure(error)
  }
}
