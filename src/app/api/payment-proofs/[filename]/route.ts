import { NextResponse } from "next/server"
import { getSession, requireAuth } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { isOwnedPaymentProof, paymentProofUrl, readPaymentProof, validProofFilename } from "@/lib/payment-proofs"

export async function GET(_req: Request, { params }: { params: Promise<{ filename: string }> }) {
  const result = await requireAuth()
  if (result.error) return result.error
  const user = getSession(result)!.user
  const { filename } = await params
  const headers = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", Vary: "Cookie" }
  if (!validProofFilename(filename)) return new NextResponse(null, { status: 404, headers })
  const isStaff = user.role === "ADMIN" || user.role === "EMPLOYEE"
  if (!isStaff && !await isOwnedPaymentProof(paymentProofUrl(filename), user.id)) {
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
