import { NextResponse } from "next/server"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"

const SELECT = { id: true, name: true, customerType: true, creditLimit: true, creditBalance: true } as const

/** Customer lookup for the POS: credit sale check (default), direct id
 *  preselect (?id=) from the 360 ficha, and ?all=1 for apartados/cotizaciones
 *  donde cualquier cliente aprobado aplica — no solo los que tienen crédito. */
export async function GET(req: Request) {
  const result = await requireAdminOrEmployee()
  if (result.error) return result.error
  const businessId = businessIdOf(getSession(result)!)
  const params = new URL(req.url).searchParams

  const id = params.get("id")?.trim()
  if (id) {
    const user = await prisma.user.findFirst({
      where: { id, businessId, role: "CUSTOMER", status: "APPROVED" },
      select: SELECT,
    })
    return NextResponse.json({ users: user ? [user] : [] }, { headers: { "Cache-Control": "private, no-store" } })
  }

  const search = params.get("search")?.trim() ?? ""
  if (search.length < 2 || search.length > 100) return NextResponse.json({ users: [] })
  const all = params.get("all") === "1"
  const users = await prisma.user.findMany({
    where: {
      businessId, role: "CUSTOMER", status: "APPROVED",
      ...(all ? {} : { creditLimit: { not: null } }),
      OR: [{ name: { contains: search, mode: "insensitive" } }, { phone: { contains: search } }],
    },
    select: SELECT,
    take: 8, orderBy: { name: "asc" },
  })
  return NextResponse.json({ users }, { headers: { "Cache-Control": "private, no-store" } })
}
