import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

/**
 * Health check para Docker y monitoreo.
 * - 200: app y BD OK
 * - 503: BD no responde (útil para orquestadores)
 */
export async function GET() {
  const timestamp = new Date().toISOString()

  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({
      status: "ok",
      db: "connected",
      timestamp,
    })
  } catch (err) {
    return NextResponse.json(
      {
        status: "degraded",
        db: "disconnected",
        timestamp,
      },
      { status: 503 }
    )
  }
}
