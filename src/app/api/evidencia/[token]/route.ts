import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { operationKeySchema } from "@/lib/domain/operations"
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
const READ_WINDOW_MS = 60 * 1000
const MAX_READS = 60 // consultas por minuto por IP
// Margen para el framing multipart (boundary, headers de parte, campo label):
// el Content-Length declara archivo + empaque, no solo la imagen.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024
// El label público no es texto libre: va a la galería del seguimiento del
// cliente y cualquiera con el link podría rotular fotos con texto arbitrario
// (defacement suave). Solo pasan las sugerencias que ofrece la página
// (/evidencia/[token]); lo demás se publica como "Evidencia".
const LABEL_WHITELIST = ["Frente", "Trasera", "Detalle", "Pantalla", "Antes", "Después"] as const
const normalizePublicLabel = (raw: unknown): string | null => {
  if (typeof raw !== "string" || !raw.trim()) return null
  const canonical = LABEL_WHITELIST.find(s => s.toLowerCase() === raw.trim().toLowerCase())
  return canonical ?? "Evidencia"
}

// Caducidad del QR de evidencias: NULL = token histórico (anterior a la
// caducidad) y sigue válido — la vigencia solo corre para tokens emitidos
// con uploadTokenExpiresAt. Un token vencido responde 410, distinto del 404
// genérico, para que la página pública muestre "link expirado" y no
// "enlace inválido".
function expired(uploadTokenExpiresAt: Date | null): boolean {
  return uploadTokenExpiresAt !== null && uploadTokenExpiresAt.getTime() < Date.now()
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!checkAndRecord("evidencia-read", getClientIp(req), READ_WINDOW_MS, MAX_READS)) {
    return NextResponse.json(
      { error: "Demasiadas consultas. Intenta de nuevo en un momento." },
      { status: 429, headers: NO_STORE },
    )
  }
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
    const label = normalizePublicLabel(form.get("label"))
    // Idempotencia opcional (la página pública manda idempotencyKey por
    // archivo): un reintento con la misma llave y el MISMO archivo devuelve
    // la foto ya registrada en vez de duplicarla. Una llave malformada se
    // ignora — el upload sigue su curso sin deduplicar.
    const rawKey = form.get("idempotencyKey")
    const parsedKey = typeof rawKey === "string" && rawKey.trim() ? operationKeySchema.safeParse(rawKey) : null
    const idempotencyKey = parsedKey?.success ? parsedKey.data : null

    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!evidenceImageFormat(bytes)) {
      return NextResponse.json({ error: "Solo se aceptan imágenes JPG, PNG o WebP." }, { status: 400, headers: NO_STORE })
    }

    const photoPayload = (photo: { id: string; label: string | null; createdAt: Date | string }) =>
      ({ photo: { id: photo.id, label: photo.label, createdAt: photo.createdAt } })
    const requestHash = createHash("sha256").update(JSON.stringify({ orderId: order.id, label })).update(bytes).digest("hex")
    if (idempotencyKey) {
      const existing = await prisma.businessOperation.findUnique({ where: { key: idempotencyKey } })
      if (existing) {
        if (existing.businessId !== order.businessId || existing.kind !== "PUBLIC_EVIDENCE_UPLOAD" || existing.requestHash !== requestHash) {
          return NextResponse.json({ error: "El identificador ya se usó para otra operación." }, { status: 409, headers: NO_STORE })
        }
        const receipt = existing.response as { photo?: { id: string; label: string | null; createdAt: string } } | null
        if (receipt?.photo?.id) return NextResponse.json(photoPayload(receipt.photo), { status: 201, headers: NO_STORE })
      }
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
      const response = photoPayload(saved)
      // Recibo idempotente post-commit: el reintento del cliente encuentra
      // esta foto en vez de subir duplicada (misma convención que el upload
      // de staff en /api/workshop/[id]/photos).
      if (idempotencyKey) {
        await prisma.businessOperation.create({
          data: { key: idempotencyKey, actorId: order.createdById, businessId: order.businessId, kind: "PUBLIC_EVIDENCE_UPLOAD", requestHash, response: response as never },
        }).catch(() => {})
      }
      return NextResponse.json(response, { status: 201, headers: NO_STORE })
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
