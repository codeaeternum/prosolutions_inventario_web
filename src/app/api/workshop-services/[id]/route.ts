import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"
import { BusinessError, transaction } from "@/lib/domain/operations"
import { missingPriceScopeModels, normalizeServicePrices, servicePriceSelect, servicePricesSchema } from "@/lib/service-pricing"

const updateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  // null explícito = quitar el precio fijo (pasa a "según dispositivo").
  priceCents: z.number().int().min(0).max(100000000).nullable().optional(),
  equipmentType: z.string().trim().max(80).nullable().optional(),
  // Set completo de precios por dispositivo: reemplaza al existente
  // ([] los borra todos; omitir la clave los deja intactos).
  prices: servicePricesSchema.optional(),
  isActive: z.boolean().optional(),
})

// PATCH idempotente por naturaleza: no requiere idempotencyKey.
// isActive=false funciona como borrado suave (soft delete).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const businessId = businessIdOf(getSession(auth)!)
    const { id } = await params
    const input = updateSchema.parse(await req.json())
    const prices = input.prices === undefined ? undefined : normalizeServicePrices(input.prices)
    const service = await transaction(prisma, async tx => {
      const existing = await tx.workshopService.findUnique({ where: { id, businessId } })
      if (!existing) throw new BusinessError("Servicio no encontrado.", 404)
      if (prices !== undefined) {
        const missing = await missingPriceScopeModels(tx, businessId, prices)
        if (missing.length > 0) throw new BusinessError("Uno o más modelos del precio por dispositivo no existen en el catálogo.", 400)
      }
      await tx.workshopService.update({
        where: { id, businessId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description || null } : {}),
          ...(input.priceCents !== undefined ? { priceCents: input.priceCents } : {}),
          ...(input.equipmentType !== undefined ? { equipmentType: input.equipmentType || null } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      })
      if (prices !== undefined) {
        // Reemplazo atómico del set: borrar + crear en la misma transacción
        // serializable; el dedup del payload evita chocar los índices únicos
        // parciales (serviceId, deviceModelId) / (serviceId, equipmentType).
        await tx.workshopServicePrice.deleteMany({ where: { serviceId: id } })
        if (prices.length > 0) {
          await tx.workshopServicePrice.createMany({ data: prices.map(row => ({ serviceId: id, ...row })) })
        }
      }
      return tx.workshopService.findUniqueOrThrow({
        where: { id },
        include: { prices: { select: servicePriceSelect, orderBy: { createdAt: "asc" } } },
      })
    })
    return NextResponse.json({ service })
  } catch (error) { return businessFailure(error) }
}
