import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"
import { BusinessError, operation, operationKeySchema, transaction, type Transaction } from "@/lib/domain/operations"

// Solicitud de gasto de caja: cualquier staff la crea en PENDING; solo un ADMIN
// (distinto del solicitante) la autoriza en /api/cash-requests/[id].
const createSchema = z.object({
  branchId: z.string().min(1),
  amountCents: z.number().int().min(1).max(100000000),
  concept: z.string().trim().min(3).max(200),
  idempotencyKey: operationKeySchema.optional(),
})
const statuses = ["PENDING", "APPROVED", "REJECTED"] as const

const requestInclude = {
  branch: { select: { id: true, name: true } },
  requestedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
} satisfies Prisma.CashRequestInclude

async function createRequest(tx: Transaction, actorId: string, businessId: string, input: z.infer<typeof createSchema>) {
  const branch = await tx.branch.findFirst({ where: { id: input.branchId, isActive: true, businessId } })
  if (!branch) throw new BusinessError("Selecciona una sucursal activa.")
  // Doble-submit sin llave de idempotencia: misma persona, sucursal, monto y
  // concepto en menos de 60s devuelve la solicitud ya registrada.
  const recent = await tx.cashRequest.findFirst({
    where: { businessId, requestedById: actorId, branchId: branch.id, amountCents: input.amountCents, concept: input.concept, createdAt: { gte: new Date(Date.now() - 60_000) } },
    orderBy: { createdAt: "desc" },
    include: requestInclude,
  })
  if (recent) return { request: recent, duplicate: true as const }
  const request = await tx.cashRequest.create({
    data: { businessId, branchId: branch.id, amountCents: input.amountCents, concept: input.concept, requestedById: actorId },
    include: requestInclude,
  })
  return { request, duplicate: false as const }
}

export async function GET(req: Request) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const query = new URL(req.url).searchParams
    const status = query.get("status")
    const branchId = query.get("branchId")
    if (status && !(statuses as readonly string[]).includes(status)) {
      return NextResponse.json({ error: "Estado inválido" }, { status: 400 })
    }
    let where: Prisma.CashRequestWhereInput
    if (session.user.role === "EMPLOYEE") {
      // El empleado ve sus propias solicitudes y las pendientes de su sucursal base.
      const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { homeBranchId: true } })
      where = {
        businessId: businessIdOf(session),
        ...(branchId ? { branchId } : {}),
        OR: [
          { requestedById: session.user.id, ...(status ? { status: status as (typeof statuses)[number] } : {}) },
          ...(me?.homeBranchId ? [{ status: "PENDING" as const, branchId: me.homeBranchId }] : []),
        ],
      }
    } else {
      where = {
        businessId: businessIdOf(session),
        ...(status ? { status: status as (typeof statuses)[number] } : {}),
        ...(branchId ? { branchId } : {}),
      }
    }
    const requests = await prisma.cashRequest.findMany({ where, orderBy: { createdAt: "desc" }, take: 100, include: requestInclude })
    return NextResponse.json({ requests }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return businessFailure(error) }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const actorId = session.user.id
    const businessId = businessIdOf(session)
    const input = createSchema.parse(await req.json())
    const key = input.idempotencyKey ?? req.headers.get("idempotency-key") ?? undefined
    const result = key
      ? await operation(prisma, { key, actorId, businessId, kind: "CASH_REQUEST", permission: "staff", payload: input }, tx => createRequest(tx, actorId, businessId, input))
      : await transaction(prisma, tx => createRequest(tx, actorId, businessId, input))
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 })
  } catch (error) { return businessFailure(error) }
}
