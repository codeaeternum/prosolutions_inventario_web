import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export async function GET() {
  const timestamp = new Date().toISOString()
  const headers = { "Cache-Control": "no-store" }
  try {
    // Validate critical tables and the required migration, without exposing records.
    await prisma.$transaction([
      prisma.$queryRaw`SELECT "id", "stock" FROM "Product" LIMIT 0`,
      prisma.$queryRaw`SELECT "id", "businessVersion", "paymentMethod" FROM "InventoryMovement" LIMIT 0`,
      prisma.$queryRaw`SELECT "id", "version", "status" FROM "RepairOrder" LIMIT 0`,
      prisma.$queryRaw`SELECT "id", "type" FROM "RepairEvent" LIMIT 0`,
      prisma.$queryRaw`SELECT "id", "role", "status" FROM "User" LIMIT 0`,
      prisma.$queryRaw`SELECT "id", "status", "businessVersion" FROM "Reservation" LIMIT 0`,
      prisma.$queryRaw`SELECT "key", "requestHash", "response" FROM "BusinessOperation" LIMIT 0`,
      prisma.$queryRaw`SELECT "id", "amount" FROM "CreditMovement" LIMIT 0`,
      prisma.$queryRaw`SELECT "id", "amount" FROM "CashMovement" LIMIT 0`,
    ])
    return NextResponse.json({ status: "ok", schema: "ready", timestamp }, { headers })
  } catch {
    return NextResponse.json(
      { status: "degraded", schema: "unavailable", timestamp },
      { status: 503, headers },
    )
  }
}
