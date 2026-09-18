import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { createRepair } from "@/lib/domain/workshop"
import { orderTotalCents } from "@/lib/workshop-money"
import { businessFailure } from "@/lib/domain/http"
import { operation, operationKeySchema } from "@/lib/domain/operations"
import { repairLabels } from "@/lib/workshop-labels"

// Internal pilot. Open staff access only after branch/technician permissions are implemented.
export async function GET(req: Request) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const businessId = businessIdOf(getSession(auth)!)
    const query = new URL(req.url).searchParams
    const page = Math.max(1, Math.min(1000, Number(query.get("page")) || 1))
    const search = (query.get("q") ?? "").trim().slice(0, 100)
    const folio = /^(?:OT-)?0*(\d+)$/i.exec(search)?.[1]
    const orderNumber = folio && Number.isSafeInteger(Number(folio)) && Number(folio) <= 2147483647 ? Number(folio) : undefined
    const branchId = query.get("branchId") || undefined
    const status = query.get("status")
    const view = query.get("view")
    if (status && !Object.hasOwn(repairLabels, status)) return NextResponse.json({ error: "Estado inválido" }, { status: 400 })
    if (view && !["debt", "today", "overdue"].includes(view)) return NextResponse.json({ error: "Vista inválida" }, { status: 400 })
    const now = new Date()
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const dayEnd = new Date(dayStart.getTime() + 86400000)
    const openStages = Object.keys(repairLabels).filter(s => !["DELIVERED", "CANCELLED"].includes(s))
    const where = {
      businessId,
      ...(branchId ? { currentBranchId: branchId } : {}),
      ...(status ? { status: status as keyof typeof repairLabels } : {}),
      ...(view === "today" ? { promisedAt: { gte: dayStart, lt: dayEnd }, status: { in: openStages as never } } : {}),
      ...(view === "overdue" ? { promisedAt: { lt: dayStart }, status: { in: openStages as never } } : {}),
      ...(view === "debt" ? { status: { in: openStages as never } } : {}),
      ...(search ? { OR: [...["customerName", "customerPhone", "model", "serialNumber"].map(field => ({ [field]: { contains: search, mode: "insensitive" as const } })), ...(orderNumber === undefined ? [] : [{ number: orderNumber }])] } : {}),
    }
    // Cobros que mueven el saldo: CONFIRMED suman y los reembolsos REFUNDED
    // (amount negativo) restan — neto = dinero retenido por la orden.
    const paymentWhere = { status: { in: ["CONFIRMED", "REFUNDED"] as ("CONFIRMED" | "REFUNDED")[] } }
    const orderInclude = {
      currentBranch: true, intakeBranch: true, assignedTo: { select: { id: true, name: true } },
      payments: { where: paymentWhere, select: { amount: true, purpose: true, status: true } },
      // Refacciones autorizadas: se cobran además de la mano de obra.
      parts: { where: { status: "APPROVED" as const }, select: { qty: true, unitCostCents: true, unitPriceCents: true, status: true } },
    }
    const orderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }]
    if (view === "debt") {
      // El adeudo = total de la orden (mano de obra + refacciones autorizadas,
      // o cargo de diagnóstico) − lo retenido. No cabe en un `where` de Prisma
      // (partes son qty×precio por fila), así que se calcula por orden ANTES
      // de paginar — el filtro post-paginación inflaba total/totalPages y
      // escondía las órdenes sin ningún cobro registrado.
      const [candidates, paidRows, branches, staff] = await Promise.all([
        prisma.repairOrder.findMany({ where, orderBy, select: { id: true, status: true, quoteCents: true, approvedQuoteCents: true, diagnosticFeeCents: true } }),
        prisma.payment.groupBy({ by: ["repairOrderId"], where: { repairOrderId: { not: null }, businessId, ...paymentWhere }, _sum: { amount: true } }),
        prisma.branch.findMany({ where: { isActive: true, businessId }, orderBy: { name: "asc" } }),
        prisma.user.findMany({ where: { status: "APPROVED", role: { in: ["ADMIN", "EMPLOYEE"] }, businessId }, select: { id: true, name: true } }),
      ])
      const partRows = await prisma.repairPart.findMany({ where: { orderId: { in: candidates.map(order => order.id) }, status: "APPROVED" }, select: { orderId: true, qty: true, unitCostCents: true, unitPriceCents: true } })
      const paidByOrder = new Map(paidRows.map(row => [row.repairOrderId as string, Math.round((row._sum?.amount ?? 0) * 100)]))
      const partsByOrder = new Map<string, typeof partRows>()
      for (const part of partRows) {
        const list = partsByOrder.get(part.orderId) ?? []
        list.push(part)
        partsByOrder.set(part.orderId, list)
      }
      const owing = candidates.filter(order => orderTotalCents(order, partsByOrder.get(order.id) ?? []) - (paidByOrder.get(order.id) ?? 0) > 0)
      const pageIds = new Set(owing.slice((page - 1) * 20, page * 20).map(order => order.id))
      const pageOrders = await prisma.repairOrder.findMany({ where: { id: { in: [...pageIds] } }, include: orderInclude })
      const byId = new Map(pageOrders.map(order => [order.id, order]))
      const orders = owing.slice((page - 1) * 20, page * 20).map(order => byId.get(order.id)).filter((order): order is NonNullable<typeof order> => order !== undefined)
      return NextResponse.json({ orders, total: owing.length, branches, staff, page, totalPages: Math.max(1, Math.ceil(owing.length / 20)) }, { headers: { "Cache-Control": "private, no-store" } })
    }
    const [orders, total, branches, staff] = await Promise.all([
      prisma.repairOrder.findMany({ where, take: 20, skip: (Math.floor(page) - 1) * 20, orderBy, include: orderInclude }),
      prisma.repairOrder.count({ where }), prisma.branch.findMany({ where: { isActive: true, businessId }, orderBy: { name: "asc" } }),
      prisma.user.findMany({ where: { status: "APPROVED", role: { in: ["ADMIN", "EMPLOYEE"] }, businessId }, select: { id: true, name: true } }),
    ])
    return NextResponse.json({ orders, total, branches, staff, page, totalPages: Math.max(1, Math.ceil(total / 20)) }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return businessFailure(error) }
}
export async function POST(req: Request) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const actorId = session.user.id
    const businessId = businessIdOf(session)
    const body = await req.json()
    if (body.action === "CREATE_BRANCH") {
      const input = z.object({ name: z.string().trim().min(2).max(80), idempotencyKey: operationKeySchema }).parse(body)
      const result = await operation(prisma, { key: input.idempotencyKey, actorId, businessId, kind: "BRANCH_CREATE", permission: "admin", payload: input.name }, async tx => ({ branch: await tx.branch.create({ data: { businessId, name: input.name } }) }))
      return NextResponse.json(result, { status: 201 })
    }
    return NextResponse.json(await createRepair(prisma, actorId, businessId, body), { status: 201 })
  } catch (error) { return businessFailure(error) }
}
