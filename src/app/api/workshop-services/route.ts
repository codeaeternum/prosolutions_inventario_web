import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"
import { operation, operationKeySchema } from "@/lib/domain/operations"

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(300).optional(),
  // null/omitido = el precio depende del dispositivo; se cotiza al recibir.
  priceCents: z.number().int().min(0).max(100000000).nullable().optional(),
  equipmentType: z.string().trim().max(80).optional(),
  idempotencyKey: operationKeySchema,
})

// Catálogo de servicios del taller. Por defecto solo activos; ?all=1 incluye inactivos.
export async function GET(req: Request) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const query = new URL(req.url).searchParams
    const search = (query.get("q") ?? "").trim().slice(0, 100)
    const includeInactive = query.get("all") === "1"
    const services = await prisma.workshopService.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
      },
      orderBy: { name: "asc" },
      take: 30,
    })
    return NextResponse.json({ services }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return businessFailure(error) }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const actorId = getSession(auth)!.user.id
    const { idempotencyKey, ...input } = createSchema.parse(await req.json())
    const result = await operation(prisma, { key: idempotencyKey, actorId, kind: "WORKSHOP_SERVICE_CREATE", permission: "admin", payload: input }, async tx => {
      const service = await tx.workshopService.create({
        data: {
          name: input.name,
          description: input.description || null,
          priceCents: input.priceCents ?? null,
          equipmentType: input.equipmentType || null,
        },
      })
      return { service }
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) { return businessFailure(error) }
}
