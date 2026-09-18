import { NextResponse } from "next/server"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"
import { BusinessError } from "@/lib/domain/operations"

// DeviceModel mezcla dos scopes: global (businessId null, solo superadmin lo
// borra) y privado del tenant (su staff lo borra). Un modelo de OTRO tenant
// responde 404 — no se revela su existencia.
// Borrado físico: no hay órdenes que referencien su id, así que eliminar no
// rompe nada.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const tenantId = businessIdOf(session)
    const { id } = await params
    const existing = await prisma.deviceModel.findFirst({
      where: { id, OR: [{ businessId: tenantId }, { businessId: null }] },
    })
    if (!existing) throw new BusinessError("Modelo no encontrado.", 404)
    if (existing.businessId === null && session.user.isSuperAdmin !== true) {
      throw new BusinessError("Solo la plataforma puede eliminar modelos del catálogo global.", 403)
    }
    await prisma.deviceModel.delete({ where: { id: existing.id } })
    return NextResponse.json({ ok: true })
  } catch (error) { return businessFailure(error) }
}
