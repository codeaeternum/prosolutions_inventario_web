import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireAdmin, requireAdminOrEmployee } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"
import { operation, operationKeySchema } from "@/lib/domain/operations"

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  operationId: operationKeySchema,
})

export async function GET() {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const branches = await prisma.branch.findMany({
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
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const actorId = getSession(auth)!.user.id
    const input = createSchema.parse(await req.json())
    const result = await operation(prisma, { key: input.operationId, actorId, kind: "BRANCH_CREATE", payload: input, permission: "admin" }, async tx => {
      const branch = await tx.branch.create({ data: { name: input.name } })
      return { branch }
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) { return businessFailure(error) }
}
