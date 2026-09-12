import { NextResponse } from "next/server"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const result = await requireAdminOrEmployee()
  const session = getSession(result)
  if (!session) {
    return result.error ?? NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  try {
    const setting = await prisma.systemSettings.findUnique({
      where: { key: "ticket_business_name" },
    })
    return NextResponse.json(
      { name: setting?.value || "ProSolutions" },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    console.error("Error fetching business name:", error)
    return NextResponse.json(
      { name: "ProSolutions" },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  }
}
