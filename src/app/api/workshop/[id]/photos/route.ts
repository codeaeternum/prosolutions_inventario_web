import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import { assertBranchAllowed, getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"
import { BusinessError, operationKeySchema } from "@/lib/domain/operations"
import { checkAndRecord } from "@/lib/rate-limit"
import { deleteRepairPhotoFile, evidenceImageFormat, MAX_EVIDENCE_BYTES, writeRepairPhoto } from "@/lib/repair-evidence"

// Órdenes en estado terminal: la evidencia es parte del expediente cerrado.
// Solo ADMIN puede agregar (p. ej. garantía) o borrar en ellas; el técnico
// solo en órdenes abiertas — no puede borrar evidencia de lo ya entregado.
const TERMINAL_STAGES = ["DELIVERED", "CANCELLED", "NOT_AUTHORIZED", "NOT_REPAIRED"]
const closedForEmployee = (status: string, role: string | undefined) =>
  TERMINAL_STAGES.includes(status) && role !== "ADMIN"

// Margen para el framing multipart (boundary, headers de parte, campo label):
// el Content-Length declara archivo + empaque, no solo la imagen.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024
const PHOTO_WINDOW_MS = 60 * 60 * 1000
const MAX_PHOTO_UPLOADS = 60 // fotos por hora por usuario staff

// Respuesta pública de la foto creada: la UI recarga la ficha tras subir,
// así que basta id/label/fecha — el filePath interno del disco jamás sale
// de la respuesta (la imagen se sirve por /api/evidence?id=<cuid>).
const photoPayload = (photo: { id: string; label: string | null; createdAt: Date | string }) =>
  ({ photo: { id: photo.id, label: photo.label, createdAt: photo.createdAt } })

// Sube una evidencia (jpeg/png/webp, ≤5 MB) a una orden de reparación.
// El archivo queda en data/uploads/repairs/<orderId>/<photoId>.<ext> y se
// sirve por /api/evidence?id=<photoId> (los ids son cuid no adivinables).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Rechazo temprano por Content-Length: si el cuerpo completo ya supera el
    // tope de la imagen + framing, no hace falta buferarlo (formData() carga
    // todo en memoria). El chequeo de file.size sigue siendo la guarda real.
    const declared = Number(req.headers.get("content-length"))
    if (Number.isFinite(declared) && declared > MAX_EVIDENCE_BYTES + MULTIPART_OVERHEAD_BYTES) {
      throw new BusinessError("La imagen debe pesar máximo 5 MB.", 413)
    }

    const auth = await requireModule("taller")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const actorId = session.user.id
    const businessId = businessIdOf(session)
    const { id } = await params

    // Subida de staff con tope por usuario (el flujo real son fotos del
    // equipo: 60/hora cubre jornadas intensas de recepción).
    if (!checkAndRecord("workshop-photos", actorId, PHOTO_WINDOW_MS, MAX_PHOTO_UPLOADS)) {
      throw new BusinessError("Demasiadas subidas. Intenta de nuevo en una hora.", 429)
    }

    const order = await prisma.repairOrder.findUnique({ where: { id, businessId }, select: { id: true, status: true, currentBranchId: true } })
    if (!order) throw new BusinessError("Orden no encontrada.", 404)
    // La evidencia se sube sobre la orden: misma barrera de sucursal que la
    // ficha — un empleado restringido no documenta órdenes de otra sucursal.
    const deniedBranch = assertBranchAllowed(session, order.currentBranchId)
    if (deniedBranch) return deniedBranch
    if (closedForEmployee(order.status, session.user.role)) {
      throw new BusinessError("La orden está cerrada; solo un administrador puede agregar evidencia.", 403)
    }

    const form = await req.formData()
    const file = form.get("file")
    if (!(file instanceof File)) throw new BusinessError("Adjunta una imagen en el campo file.")
    if (file.size === 0 || file.size > MAX_EVIDENCE_BYTES) throw new BusinessError("La imagen debe pesar máximo 5 MB.")
    const rawLabel = form.get("label")
    const label = typeof rawLabel === "string" ? rawLabel.trim().slice(0, 80) : ""
    const rawKey = form.get("idempotencyKey")
    const idempotencyKey = typeof rawKey === "string" && rawKey.trim() ? operationKeySchema.parse(rawKey) : null

    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!evidenceImageFormat(bytes)) throw new BusinessError("Solo se aceptan imágenes JPG, PNG o WebP.")

    // Idempotencia opcional del upload: un reintento con la MISMA llave y el
    // MISMO archivo devuelve la foto ya registrada en vez de duplicarla. Se
    // asienta como recibo BusinessOperation (misma convención que domain/
    // operations) una vez el archivo quedó persistido — fuera de
    // transacción porque escribir disco no participa del tx de Prisma.
    const requestHash = createHash("sha256").update(JSON.stringify({ orderId: id, label })).update(bytes).digest("hex")
    if (idempotencyKey) {
      const existing = await prisma.businessOperation.findUnique({ where: { key: idempotencyKey } })
      if (existing) {
        if (existing.actorId !== actorId || existing.businessId !== businessId || existing.kind !== "REPAIR_PHOTO_UPLOAD" || existing.requestHash !== requestHash) {
          throw new BusinessError("El identificador ya se usó para otra operación.", 409, "IDEMPOTENCY_CONFLICT")
        }
        const receipt = existing.response as { photo?: { id: string; label: string | null; createdAt: string } } | null
        if (receipt?.photo?.id) return NextResponse.json(photoPayload(receipt.photo), { status: 201, headers: { "Cache-Control": "private, no-store" } })
      }
    }

    // Se crea el registro primero para usar su cuid como nombre de archivo;
    // si el disco falla, el registro se revierte — y si el archivo ya quedó
    // escrito pero falla el update o el evento, el archivo también se borra
    // para no dejarlo huérfano.
    const photo = await prisma.repairPhoto.create({
      data: { businessId, orderId: id, filePath: "pending", label: label || null, uploadedById: actorId },
    })
    let writtenPath: string | null = null
    try {
      const filePath = await writeRepairPhoto(id, photo.id, bytes)
      writtenPath = filePath
      const saved = await prisma.repairPhoto.update({ where: { id: photo.id }, data: { filePath } })
      await prisma.repairEvent.create({
        data: { businessId, actorId, orderId: id, type: "PHOTO", detail: `Evidencia agregada${label ? `: ${label}` : ""}` },
      })
      const response = photoPayload(saved)
      // Recibo idempotente post-commit: si el cliente reintenta con la misma
      // llave encuentra esta foto en vez de subir duplicada. Una carrera con
      // la misma llave pierde el insert y cae al catch — el recibo ganador
      // es el que responde el reintento.
      if (idempotencyKey) {
        await prisma.businessOperation.create({
          data: { key: idempotencyKey, actorId, businessId, kind: "REPAIR_PHOTO_UPLOAD", requestHash, response: response as never },
        }).catch(() => {})
      }
      return NextResponse.json(response, { status: 201, headers: { "Cache-Control": "private, no-store" } })
    } catch (error) {
      await prisma.repairPhoto.delete({ where: { id: photo.id } }).catch(() => {})
      if (writtenPath) await deleteRepairPhotoFile(writtenPath).catch(() => {})
      throw error
    }
  } catch (error) { return businessFailure(error) }
}

// DELETE { photoId } — borra el registro y el archivo del disco.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModule("taller")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const actorId = session.user.id
    const businessId = businessIdOf(session)
    const { id } = await params

    const body = await req.json().catch(() => null) as { photoId?: unknown } | null
    const photoId = typeof body?.photoId === "string" ? body.photoId : ""
    if (!photoId) throw new BusinessError("Indica la foto a eliminar.")

    const order = await prisma.repairOrder.findUnique({ where: { id, businessId }, select: { status: true, currentBranchId: true } })
    if (!order) throw new BusinessError("Orden no encontrada.", 404)
    // Borrar evidencia de una orden de otra sucursal sigue el mismo criterio
    // que subirla: la sucursal actual de la orden debe estar asignada.
    const deniedBranch = assertBranchAllowed(session, order.currentBranchId)
    if (deniedBranch) return deniedBranch
    if (closedForEmployee(order.status, session.user.role)) {
      throw new BusinessError("La orden está cerrada; solo un administrador puede eliminar evidencia.", 403)
    }

    const photo = await prisma.repairPhoto.findFirst({ where: { id: photoId, orderId: id, businessId } })
    if (!photo) throw new BusinessError("La evidencia no pertenece a esta orden.", 404)

    await prisma.repairPhoto.delete({ where: { id: photo.id } })
    await deleteRepairPhotoFile(photo.filePath).catch(() => {})
    await prisma.repairEvent.create({
      data: { businessId, actorId, orderId: id, type: "PHOTO", detail: `Evidencia eliminada${photo.label ? `: ${photo.label}` : ""}` },
    })
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return businessFailure(error) }
}
