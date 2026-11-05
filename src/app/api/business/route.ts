import { NextResponse } from "next/server"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { getBusinessSetting } from "@/lib/settings"
import prisma from "@/lib/prisma"

export async function GET() {
  const result = await requireAdminOrEmployee()
  const session = getSession(result)
  if (!session) {
    return result.error ?? NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  try {
    const businessId = businessIdOf(session)
    const [setting, business] = await Promise.all([
      getBusinessSetting(businessId, "ticket_business_name"),
      prisma.business.findUnique({ where: { id: businessId }, select: { name: true } }).catch(() => null),
    ])
    return NextResponse.json(
      { name: setting || business?.name || "Reficio" },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    console.error("Error fetching business name:", error)
    return NextResponse.json(
      { name: "Reficio" },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  }
}
