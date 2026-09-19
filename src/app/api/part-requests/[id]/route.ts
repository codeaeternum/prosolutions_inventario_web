import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"

const NO_STORE = { "Cache-Control": "no-store" } as const

const updateSchema = z.object({
  status: z.enum(["OPEN", "CONTACTED", "CLOSED"]),
})

// PATCH /api/part-requests/:id  { status }
// Staff con módulo mercado: marca la gestión de una solicitud del directorio
// público (contactada por WhatsApp, cerrada, o reabierta). El modelo es
// global — sin businessId — pero el cambio exige staff con empresa.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModule("mercado")
    if (auth.error) return auth.error
    businessIdOf(getSession(auth)!)
    const { id } = await params

    const parseResult = updateSchema.safeParse(await req.json().catch(() => null))
    if (!parseResult.success) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400, headers: NO_STORE })
    }

    const existing = await prisma.partRequest.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: "Solicitud no encontrada" }, { status: 404, headers: NO_STORE })
    }

    const request = await prisma.partRequest.update({
      where: { id },
      data: { status: parseResult.data.status },
    })

    return NextResponse.json({ request }, { headers: NO_STORE })
  } catch (error) {
    console.error("[part-requests] Error al actualizar la solicitud:", error)
    return NextResponse.json(
      { error: "Error al actualizar la solicitud" },
      { status: 500, headers: NO_STORE },
    )
  }
}
