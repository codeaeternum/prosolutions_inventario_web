import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireAdminOrEmployee, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"
import { operation, operationKeySchema } from "@/lib/domain/operations"
import { recordAudit } from "@/lib/audit"

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  operationId: operationKeySchema,
})

export async function GET() {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const branches = await prisma.branch.findMany({
      where: { businessId: businessIdOf(getSession(auth)!) },
      orderBy: { createdAt: "asc" },
      include: {
        _count: { select: { stocks: true, homeStaff: true, receivedOrders: true, sales: true } },
        cashRegisters: { where: { status: "OPEN" }, select: { id: true, openedAt: true } },
      },
    })
    return NextResponse.json({ branches }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return businessFailure(error) }
}

export async function POST(req: Request) {
  try {
    const auth = await requireModule("sucursales")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const actorId = session.user.id
    const businessId = businessIdOf(session)
    const input = createSchema.parse(await req.json())
    const result = await operation(prisma, { key: input.operationId, actorId, businessId, kind: "BRANCH_CREATE", payload: input, permission: "admin" }, async tx => {
      const branch = await tx.branch.create({ data: { businessId, name: input.name } })
      // Bitácora dentro del work: comitea con la sucursal y no se duplica en
      // reintentos (el replay sirve el recibo sin re-ejecutar esta función).
      await recordAudit(tx, {
        businessId,
        actorId,
        action: "BRANCH_CREATE",
        entity: "branch",
        entityId: branch.id,
        entityName: branch.name,
        summary: `Creó la sucursal "${branch.name}"`,
      })
      return { branch }
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) { return businessFailure(error) }
}
