import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { checkAndRecord, getClientIp } from "@/lib/rate-limit"
import { getBusinessSetting, getOrderFolioDigits } from "@/lib/settings"
import { formatFolio } from "@/lib/workshop-labels"
import { deleteRepairPhotoFile, evidenceImageFormat, MAX_EVIDENCE_BYTES, writeRepairPhoto } from "@/lib/repair-evidence"

// Subida pública de evidencias por QR (técnico en celular, sin login). El
// token es el uploadToken (cuid) de la orden: quien lo tiene puede subir.
// 404 genérico si no existe — no revelar si el token es válido o no.
const NO_STORE = { "Cache-Control": "no-store" } as const
const INVALID = { error: "Enlace no válido o expirado." }
const EXPIRED = { error: "Este link ya no está vigente." }
const WINDOW_MS = 60 * 60 * 1000
const MAX_UPLOADS = 20 // fotos por hora por IP
// Margen para el framing multipart (boundary, headers de parte, campo label):
// el Content-Length declara archivo + empaque, no solo la imagen.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024

// Caducidad del QR de evidencias: NULL = token histórico (anterior a la
// caducidad) y sigue válido — la vigencia solo corre para tokens emitidos
// con uploadTokenExpiresAt. Un token vencido responde 410, distinto del 404
// genérico, para que la página pública muestre "link expirado" y no
// "enlace inválido".
function expired(uploadTokenExpiresAt: Date | null): boolean {
  return uploadTokenExpiresAt !== null && uploadTokenExpiresAt.getTime() < Date.now()
}

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const order = await prisma.repairOrder.findUnique({
    where: { uploadToken: token },
    select: { number: true, businessId: true, uploadTokenExpiresAt: true, business: { select: { isActive: true } }, photos: { orderBy: { createdAt: "asc" }, select: { id: true, label: true, createdAt: true } } },
  })
  // Empresa suspendida: el enlace muere igual que un token inválido (404 genérico).
  if (!order || !order.business.isActive) return NextResponse.json(INVALID, { status: 404, headers: NO_STORE })
  if (expired(order.uploadTokenExpiresAt)) return NextResponse.json(EXPIRED, { status: 410, headers: NO_STORE })
  // El folio viaja ya formateado con prefijo y dígitos del negocio dueño
  // (order_prefix + order_folio_digits); ante un fallo del ajuste salen los
  // valores por defecto — el enlace público no muere por un setting.
  const [orderPrefix, folioDigits] = await Promise.all([
    getBusinessSetting(order.businessId, "order_prefix").catch(() => null),
    getOrderFolioDigits(order.businessId),
  ])
  return NextResponse.json({ orderNumber: order.number, folio: formatFolio(orderPrefix, order.number, folioDigits), photos: order.photos }, { headers: NO_STORE })
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    // Rechazo temprano por Content-Length: si el cuerpo completo ya supera el
    // tope de la imagen + framing, no hace falta buferarlo (formData() carga
    // todo en memoria). El chequeo de file.size sigue siendo la guarda real.
    const declared = Number(req.headers.get("content-length"))
    if (Number.isFinite(declared) && declared > MAX_EVIDENCE_BYTES + MULTIPART_OVERHEAD_BYTES) {
      return NextResponse.json(
        { error: "La imagen debe pesar máximo 5 MB." },
        { status: 413, headers: NO_STORE },
      )
    }

    if (!checkAndRecord("evidencia", getClientIp(req), WINDOW_MS, MAX_UPLOADS)) {
      return NextResponse.json(
        { error: "Demasiadas subidas. Intenta de nuevo en una hora." },
        { status: 429, headers: NO_STORE },
      )
    }

    const { token } = await params
    const order = await prisma.repairOrder.findUnique({
      where: { uploadToken: token },
      select: { id: true, createdById: true, businessId: true, status: true, uploadTokenExpiresAt: true, business: { select: { isActive: true } } },
    })
    // Empresa suspendida: el enlace muere igual que un token inválido (404 genérico).
    if (!order || !order.business.isActive) return NextResponse.json(INVALID, { status: 404, headers: NO_STORE })
    if (expired(order.uploadTokenExpiresAt)) return NextResponse.json(EXPIRED, { status: 410, headers: NO_STORE })
    // Orden cerrada: el sticker físico es permanente y el enlace queda vivo
    // para siempre — sin bloqueo cualquiera podría subir basura a una orden
    // ya entregada/cancelada. Se responde 404 igual que un token inválido.
    if (["DELIVERED", "CANCELLED", "NOT_AUTHORIZED", "NOT_REPAIRED"].includes(order.status)) {
      return NextResponse.json(INVALID, { status: 404, headers: NO_STORE })
    }

    const form = await req.formData()
    const file = form.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Adjunta una imagen en el campo file." }, { status: 400, headers: NO_STORE })
    }
    if (file.size === 0 || file.size > MAX_EVIDENCE_BYTES) {
      return NextResponse.json({ error: "La imagen debe pesar máximo 5 MB." }, { status: 400, headers: NO_STORE })
    }
    const rawLabel = form.get("label")
    const label = typeof rawLabel === "string" ? rawLabel.trim().slice(0, 80) : ""

    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!evidenceImageFormat(bytes)) {
      return NextResponse.json({ error: "Solo se aceptan imágenes JPG, PNG o WebP." }, { status: 400, headers: NO_STORE })
    }

    const photo = await prisma.repairPhoto.create({
      data: { businessId: order.businessId, orderId: order.id, filePath: "pending", label: label || null, uploadedById: null },
    })
    // Si el archivo ya quedó escrito pero el update del registro o el evento
    // fallan, el archivo también se borra para no dejarlo huérfano en disco.
    let writtenPath: string | null = null
    try {
      const filePath = await writeRepairPhoto(order.id, photo.id, bytes)
      writtenPath = filePath
      const saved = await prisma.repairPhoto.update({ where: { id: photo.id }, data: { filePath } })
      // El evento usa como actor a quien recibió la orden: actorId es requerido
      // y no hay sesión en el enlace público.
      await prisma.repairEvent.create({
        data: { businessId: order.businessId, actorId: order.createdById, orderId: order.id, type: "PHOTO", detail: "Evidencia subida desde enlace público" },
      })
      return NextResponse.json(
        { photo: { id: saved.id, label: saved.label, createdAt: saved.createdAt } },
        { status: 201, headers: NO_STORE },
      )
    } catch (error) {
      await prisma.repairPhoto.delete({ where: { id: photo.id } }).catch(() => {})
      if (writtenPath) await deleteRepairPhotoFile(writtenPath).catch(() => {})
      throw error
    }
  } catch (error) {
    console.error("[evidencia] Error al subir foto:", error)
    return NextResponse.json({ error: "No pudimos guardar la foto. Intenta de nuevo." }, { status: 500, headers: NO_STORE })
  }
}
