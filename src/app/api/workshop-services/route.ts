import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireAdmin, requireAdminOrEmployee } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"
import { BusinessError, operation, operationKeySchema } from "@/lib/domain/operations"
import { missingPriceScopeModels, normalizeServicePrices, servicePriceSelect, servicePricesSchema } from "@/lib/service-pricing"

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(300).optional(),
  // null/omitido = el precio depende del dispositivo; se cotiza al recibir.
  priceCents: z.number().int().min(0).max(100000000).nullable().optional(),
  equipmentType: z.string().trim().max(80).optional(),
  // Precios específicos por modelo exacto o tipo de equipo; ganan sobre priceCents.
  prices: servicePricesSchema.optional(),
  idempotencyKey: operationKeySchema,
})

// Catálogo de servicios del taller. Por defecto solo activos; ?all=1 incluye inactivos.
// Lectura abierta a staff (el mostrador la usa al recibir equipos); escritura solo admin.
export async function GET(req: Request) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const query = new URL(req.url).searchParams
    const search = (query.get("q") ?? "").trim().slice(0, 100)
    const includeInactive = query.get("all") === "1"
    const services = await prisma.workshopService.findMany({
      where: {
        businessId: businessIdOf(getSession(auth)!),
        ...(includeInactive ? {} : { isActive: true }),
        ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
      },
      // prices: alcance (deviceModelId XOR equipmentType) + precio + marca/
      // modelo del catálogo para mostrar en recepción y en el catálogo admin.
      include: { prices: { select: servicePriceSelect, orderBy: { createdAt: "asc" } } },
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
    const session = getSession(auth)!
    const actorId = session.user.id
    const businessId = businessIdOf(session)
    const { idempotencyKey, ...input } = createSchema.parse(await req.json())
    const result = await operation(prisma, { key: idempotencyKey, actorId, businessId, kind: "WORKSHOP_SERVICE_CREATE", permission: "admin", payload: input }, async tx => {
      // Dedup por alcance en el payload + los modelos deben existir en el
      // catálogo visible del tenant (global o privado).
      const prices = input.prices ? normalizeServicePrices(input.prices) : []
      const missing = await missingPriceScopeModels(tx, businessId, prices)
      if (missing.length > 0) throw new BusinessError("Uno o más modelos del precio por dispositivo no existen en el catálogo.", 400)
      const service = await tx.workshopService.create({
        data: {
          businessId,
          name: input.name,
          description: input.description || null,
          priceCents: input.priceCents ?? null,
          equipmentType: input.equipmentType || null,
          ...(prices.length > 0 ? { prices: { create: prices } } : {}),
        },
        include: { prices: { select: servicePriceSelect, orderBy: { createdAt: "asc" } } },
      })
      return { service }
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) { return businessFailure(error) }
}
