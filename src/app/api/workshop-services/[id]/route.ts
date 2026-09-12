import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"
import { BusinessError } from "@/lib/domain/operations"

const updateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  priceCents: z.number().int().min(0).max(100000000).optional(),
  equipmentType: z.string().trim().max(80).nullable().optional(),
  isActive: z.boolean().optional(),
})

// PATCH idempotente por naturaleza: no requiere idempotencyKey.
// isActive=false funciona como borrado suave (soft delete).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const { id } = await params
    const input = updateSchema.parse(await req.json())
    const existing = await prisma.workshopService.findUnique({ where: { id } })
    if (!existing) throw new BusinessError("Servicio no encontrado.", 404)
    const service = await prisma.workshopService.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.priceCents !== undefined ? { priceCents: input.priceCents } : {}),
        ...(input.equipmentType !== undefined ? { equipmentType: input.equipmentType || null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    })
    return NextResponse.json({ service })
  } catch (error) { return businessFailure(error) }
}
