import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { listSuppliers } from "@/lib/domain/purchasing"
import { businessFailure } from "@/lib/domain/http"
import { recordAudit } from "@/lib/audit"

const createSchema = z.object({
  name: z.string().trim().min(1, "El nombre es requerido").max(200),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.union([z.literal(""), z.email("Correo inválido").max(200)]).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
})

export async function GET() {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const suppliers = await listSuppliers(prisma, businessIdOf(getSession(auth)!))
    return NextResponse.json({ suppliers }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return businessFailure(error)
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)

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
        await recordAudit(prisma, {
          businessId,
          actorId: session.user.id,
          action: "SUPPLIER_UPDATE",
          entity: "supplier",
          entityId: revived.id,
          entityName: revived.name,
          summary: `Reactivó al proveedor "${revived.name}"`,
          changes: { activo: { before: false, after: true } },
        })
        return NextResponse.json(revived, { status: 200 })
      }
      return NextResponse.json({ error: "Ya existe un proveedor con ese nombre" }, { status: 400 })
    }

    try {
      const supplier = await prisma.supplier.create({
        data: { businessId, name, phone: phone || null, email: email || null, notes: notes || null },
        include: { _count: { select: { purchases: true } } },
      })
      await recordAudit(prisma, {
        businessId,
        actorId: session.user.id,
        action: "SUPPLIER_CREATE",
        entity: "supplier",
        entityId: supplier.id,
        entityName: supplier.name,
        summary: `Alta del proveedor "${supplier.name}"`,
      })
      return NextResponse.json(supplier, { status: 201 })
    } catch (error) {
      // Doble submit concurrente: el findFirst de arriba no ve al otro request;
      // el @@unique(businessId, name) corta con P2002 → conflicto legible.
      if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
        return NextResponse.json({ error: "Ya existe un proveedor con ese nombre" }, { status: 409 })
      }
      throw error
    }
  } catch (error) {
    return businessFailure(error)
  }
}
