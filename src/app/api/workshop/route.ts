import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { createRepair } from "@/lib/domain/workshop"
import { businessFailure } from "@/lib/domain/http"
import { operation, operationKeySchema } from "@/lib/domain/operations"
import { repairLabels } from "@/lib/workshop-labels"

// Internal pilot. Open staff access only after branch/technician permissions are implemented.
export async function GET(req: Request) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
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
      ...(branchId ? { currentBranchId: branchId } : {}),
      ...(status ? { status: status as keyof typeof repairLabels } : {}),
      ...(view === "today" ? { promisedAt: { gte: dayStart, lt: dayEnd }, status: { in: openStages as never } } : {}),
      ...(view === "overdue" ? { promisedAt: { lt: dayStart }, status: { in: openStages as never } } : {}),
      ...(view === "debt" ? { payments: { some: { status: "CONFIRMED" as const } }, status: { in: openStages as never } } : {}),
      ...(search ? { OR: [...["customerName", "customerPhone", "model", "serialNumber"].map(field => ({ [field]: { contains: search, mode: "insensitive" as const } })), ...(orderNumber === undefined ? [] : [{ number: orderNumber }])] } : {}),
    }
    const [orders, total, branches, staff] = await Promise.all([
      prisma.repairOrder.findMany({ where, take: 20, skip: (Math.floor(page) - 1) * 20, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { currentBranch: true, intakeBranch: true, assignedTo: { select: { id: true, name: true } }, payments: { where: { status: "CONFIRMED" }, select: { amount: true, purpose: true } } } }),
      prisma.repairOrder.count({ where }), prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      prisma.user.findMany({ where: { status: "APPROVED", role: { in: ["ADMIN", "EMPLOYEE"] } }, select: { id: true, name: true } }),
    ])
    const filtered = view === "debt" ? orders.filter(order => (order.approvedQuoteCents ?? order.quoteCents ?? 0) > order.payments.reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0)) : orders
    return NextResponse.json({ orders: filtered, total: view === "debt" ? filtered.length : total, branches, staff, page, totalPages: Math.max(1, Math.ceil((view === "debt" ? filtered.length : total) / 20)) }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return businessFailure(error) }
}
export async function POST(req: Request) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const actorId = getSession(auth)!.user.id
    const body = await req.json()
    if (body.action === "CREATE_BRANCH") {
      const input = z.object({ name: z.string().trim().min(2).max(80), idempotencyKey: operationKeySchema }).parse(body)
      const result = await operation(prisma, { key: input.idempotencyKey, actorId, kind: "BRANCH_CREATE", permission: "admin", payload: input.name }, async tx => ({ branch: await tx.branch.create({ data: { name: input.name } }) }))
      return NextResponse.json(result, { status: 201 })
    }
    return NextResponse.json(await createRepair(prisma, actorId, body), { status: 201 })
  } catch (error) { return businessFailure(error) }
}
