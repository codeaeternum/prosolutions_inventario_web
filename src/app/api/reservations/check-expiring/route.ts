import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { expireReservations } from "@/lib/domain/reservations"
import { expireQuoteDocuments } from "@/lib/domain/documents"
import { businessFailure } from "@/lib/domain/http"

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET
  if (!expected) return NextResponse.json({ error: "Cron no configurado" }, { status: 503 })
  const provided = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? req.headers.get("x-cron-secret") ?? ""
  const a = Buffer.from(expected), b = Buffer.from(provided)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  try {
    const [reservations, quotes] = await Promise.all([
      expireReservations(prisma),
      expireQuoteDocuments(prisma),
    ])
    return NextResponse.json({ success: true, ...reservations, ...quotes })
  }
  catch (error) { return businessFailure(error) }
}
export const POST = GET
