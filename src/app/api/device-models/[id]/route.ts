import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"
import { BusinessError } from "@/lib/domain/operations"

// Borrado físico: DeviceModel es solo un catálogo de autocompletado, no hay
// órdenes que referencien su id, así que eliminar no rompe nada.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const { id } = await params
    const existing = await prisma.deviceModel.findUnique({ where: { id } })
    if (!existing) throw new BusinessError("Modelo no encontrado.", 404)
    await prisma.deviceModel.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) { return businessFailure(error) }
}
