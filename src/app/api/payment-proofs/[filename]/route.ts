import { NextResponse } from "next/server"
import { getSession, requireAuth } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { isOwnedPaymentProof, paymentProofUploaderId, paymentProofUrl, readPaymentProof, validProofFilename } from "@/lib/payment-proofs"

export async function GET(_req: Request, { params }: { params: Promise<{ filename: string }> }) {
  const result = await requireAuth()
  if (result.error) return result.error
  const user = getSession(result)!.user
  const { filename } = await params
  const headers = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", Vary: "Cookie" }
  if (!validProofFilename(filename)) return new NextResponse(null, { status: 404, headers })
  const isStaff = user.role === "ADMIN" || user.role === "EMPLOYEE"
  if (isStaff) {
    // El staff solo lee comprobantes de SU empresa: por el negocio de quien lo
    // subió o, para archivos legados sin metadatos, por una reserva del negocio
    // que lo referencie. Nunca se revela si el archivo existe en otro tenant.
    const businessId = businessIdOf(getSession(result)!)
    const uploaderId = await paymentProofUploaderId(filename)
    const allowed = uploaderId
      ? (await prisma.user.findUnique({ where: { id: uploaderId }, select: { businessId: true } }))?.businessId === businessId
      : !!(await prisma.reservation.findFirst({
          where: { businessId, paymentProofUrl: { in: [paymentProofUrl(filename), `/uploads/payments/${filename}`] } },
          select: { id: true },
        }))
    if (!allowed) return new NextResponse(null, { status: 404, headers })
  } else if (!await isOwnedPaymentProof(paymentProofUrl(filename), user.id)) {
    const ownReservation = await prisma.reservation.findFirst({
      where: { userId: user.id, paymentProofUrl: { in: [paymentProofUrl(filename), `/uploads/payments/${filename}`] } }, select: { id: true },
    })
    // Do not disclose existence to unrelated users.
    if (!ownReservation) return new NextResponse(null, { status: 404, headers })
  }
  const file = await readPaymentProof(filename)
  if (!file) return new NextResponse(null, { status: 404, headers })
  return new NextResponse(new Uint8Array(file.bytes), { headers: { ...headers, "Content-Type": file.mime, "Content-Disposition": `inline; filename="${filename}"` } })
}
