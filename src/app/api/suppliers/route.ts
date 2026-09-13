import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { listSuppliers } from "@/lib/domain/purchasing"
import { businessFailure } from "@/lib/domain/http"

const createSchema = z.object({
  name: z.string().trim().min(1, "El nombre es requerido").max(200),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.union([z.literal(""), z.email("Correo inválido").max(200)]).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
})

export async function GET() {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const suppliers = await listSuppliers(prisma, businessIdOf(getSession(auth)!))
    return NextResponse.json({ suppliers }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return businessFailure(error)
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const businessId = businessIdOf(getSession(auth)!)

    const parsed = createSchema.safeParse(await req.json())
    if (!parsed.success) {
      const msg = parsed.error.flatten().fieldErrors.name?.[0] ?? parsed.error.flatten().fieldErrors.email?.[0] ?? "Datos inválidos"
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    const { name, phone, email, notes } = parsed.data

    const existing = await prisma.supplier.findFirst({ where: { businessId, name } })
    if (existing) {
      if (!existing.isActive) {
        const revived = await prisma.supplier.update({
          where: { id: existing.id },
          data: { isActive: true, phone: phone || existing.phone, email: email || existing.email, notes: notes || existing.notes },
          include: { _count: { select: { purchases: true } } },
        })
        return NextResponse.json(revived, { status: 200 })
      }
      return NextResponse.json({ error: "Ya existe un proveedor con ese nombre" }, { status: 400 })
    }

    const supplier = await prisma.supplier.create({
      data: { businessId, name, phone: phone || null, email: email || null, notes: notes || null },
      include: { _count: { select: { purchases: true } } },
    })
    return NextResponse.json(supplier, { status: 201 })
  } catch (error) {
    return businessFailure(error)
  }
}
