import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"
import { BusinessError } from "@/lib/domain/operations"

// DeviceModel es un catálogo GLOBAL compartido por todos los tenants: la
// escritura queda restringida al superadmin de plataforma — un admin de un
// tenant no puede borrar el catálogo de los demás.
// Borrado físico: no hay órdenes que referencien su id, así que eliminar no
// rompe nada.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireSuperAdmin()
    if (auth.error) return auth.error
    const { id } = await params
    const existing = await prisma.deviceModel.findUnique({ where: { id } })
    if (!existing) throw new BusinessError("Modelo no encontrado.", 404)
    await prisma.deviceModel.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) { return businessFailure(error) }
}
