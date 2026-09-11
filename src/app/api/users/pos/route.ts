import { NextResponse } from "next/server"
import { requireAdminOrEmployee } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

/** Minimal approved customer lookup needed to take a credit payment at the counter. */
export async function GET(req: Request) {
  const result = await requireAdminOrEmployee()
  if (result.error) return result.error
  const params = new URL(req.url).searchParams
  const search = params.get("search")?.trim() ?? ""
  if (search.length < 2 || search.length > 100) return NextResponse.json({ users: [] })
  const users = await prisma.user.findMany({
    where: { role: "CUSTOMER", status: "APPROVED", creditLimit: { not: null }, OR: [
      { name: { contains: search, mode: "insensitive" } }, { phone: { contains: search } },
    ] },
    select: { id: true, name: true, customerType: true, creditLimit: true, creditBalance: true },
    take: 8, orderBy: { name: "asc" },
  })
  return NextResponse.json({ users }, { headers: { "Cache-Control": "private, no-store" } })
}
