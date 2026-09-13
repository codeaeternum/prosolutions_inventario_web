import { NextResponse } from "next/server"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"
import { BusinessError } from "@/lib/domain/operations"
import { deleteRepairPhotoFile, evidenceImageFormat, MAX_EVIDENCE_BYTES, writeRepairPhoto } from "@/lib/repair-evidence"

// Sube una evidencia (jpeg/png/webp, ≤5 MB) a una orden de reparación.
// El archivo queda en data/uploads/repairs/<orderId>/<photoId>.<ext> y se
// sirve por /api/evidence?id=<photoId> (los ids son cuid no adivinables).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const actorId = session.user.id
    const businessId = businessIdOf(session)
    const { id } = await params

    const order = await prisma.repairOrder.findUnique({ where: { id, businessId }, select: { id: true } })
    if (!order) throw new BusinessError("Orden no encontrada.", 404)

    const form = await req.formData()
    const file = form.get("file")
    if (!(file instanceof File)) throw new BusinessError("Adjunta una imagen en el campo file.")
    if (file.size === 0 || file.size > MAX_EVIDENCE_BYTES) throw new BusinessError("La imagen debe pesar máximo 5 MB.")
    const rawLabel = form.get("label")
    const label = typeof rawLabel === "string" ? rawLabel.trim().slice(0, 80) : ""

    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!evidenceImageFormat(bytes)) throw new BusinessError("Solo se aceptan imágenes JPG, PNG o WebP.")

    // Se crea el registro primero para usar su cuid como nombre de archivo;
    // si el disco falla, el registro se revierte.
    const photo = await prisma.repairPhoto.create({
      data: { businessId, orderId: id, filePath: "pending", label: label || null, uploadedById: actorId },
    })
    try {
      const filePath = await writeRepairPhoto(id, photo.id, bytes)
      const saved = await prisma.repairPhoto.update({ where: { id: photo.id }, data: { filePath } })
      await prisma.repairEvent.create({
        data: { businessId, actorId, orderId: id, type: "PHOTO", detail: `Evidencia agregada${label ? `: ${label}` : ""}` },
      })
      return NextResponse.json({ photo: saved }, { status: 201 })
    } catch (error) {
      await prisma.repairPhoto.delete({ where: { id: photo.id } }).catch(() => {})
      throw error
    }
  } catch (error) { return businessFailure(error) }
}

// DELETE { photoId } — borra el registro y el archivo del disco.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const actorId = session.user.id
    const businessId = businessIdOf(session)
    const { id } = await params

    const body = await req.json().catch(() => null) as { photoId?: unknown } | null
    const photoId = typeof body?.photoId === "string" ? body.photoId : ""
    if (!photoId) throw new BusinessError("Indica la foto a eliminar.")

    const photo = await prisma.repairPhoto.findFirst({ where: { id: photoId, orderId: id, businessId } })
    if (!photo) throw new BusinessError("La evidencia no pertenece a esta orden.", 404)

    await prisma.repairPhoto.delete({ where: { id: photo.id } })
    await deleteRepairPhotoFile(photo.filePath).catch(() => {})
    await prisma.repairEvent.create({
      data: { businessId, actorId, orderId: id, type: "PHOTO", detail: `Evidencia eliminada${photo.label ? `: ${photo.label}` : ""}` },
    })
    return NextResponse.json({ ok: true })
  } catch (error) { return businessFailure(error) }
}
