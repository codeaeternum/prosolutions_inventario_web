import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"
import { operation, operationKeySchema } from "@/lib/domain/operations"
import { SUGGESTED_SERVICES } from "@/lib/workshop-service-suggestions"

const bodySchema = z.object({
  idempotencyKey: operationKeySchema,
})

// POST /api/workshop-services/seed-suggested — siembra el catálogo sugerido de
// servicios (SUGGESTED_SERVICES) en el tenant del admin. Idempotente vía
// operation() y además dedup por nombre case-insensitive contra los servicios
// ya existentes (incluye inactivos: no se recrea lo que el negocio apagó).
export async function POST(req: Request) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)
    const { idempotencyKey } = bodySchema.parse(await req.json())
    const result = await operation(
      prisma,
      { key: idempotencyKey, actorId: session.user.id, businessId, kind: "WORKSHOP_SERVICE_SEED_SUGGESTED", permission: "admin", payload: {} },
      async tx => {
        const existing = await tx.workshopService.findMany({ where: { businessId }, select: { name: true } })
        const taken = new Set(existing.map(service => service.name.trim().toLowerCase()))
        const missing = SUGGESTED_SERVICES.filter(service => !taken.has(service.name.toLowerCase()))
        if (missing.length > 0) {
          await tx.workshopService.createMany({
            data: missing.map(service => ({
              businessId,
              name: service.name,
              equipmentType: service.equipmentType,
              priceCents: null,
            })),
          })
        }
        return { created: missing.length, skipped: SUGGESTED_SERVICES.length - missing.length }
      },
    )
    return NextResponse.json(result, { status: 201 })
  } catch (error) { return businessFailure(error) }
}
