import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdminOrEmployee } from "@/lib/api-auth"

// Staff activo para el cambio rápido de usuario y asignación de órdenes.
export async function GET() {
  const authResult = await requireAdminOrEmployee()
  if (authResult.error) return authResult.error

  const staff = await prisma.user.findMany({
    where: { status: "APPROVED", role: { in: ["ADMIN", "EMPLOYEE"] } },
    select: {
      id: true, name: true, role: true, jobTitle: true,
      quickPin: true,
      homeBranch: { select: { id: true, name: true } },
    },
    orderBy: { name: "asc" },
  })

  return NextResponse.json(
    staff.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      jobTitle: u.jobTitle,
      hasPin: !!u.quickPin,
      homeBranch: u.homeBranch,
    }))
  )
}
