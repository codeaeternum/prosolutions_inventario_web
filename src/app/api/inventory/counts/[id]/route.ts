import { NextResponse, type NextRequest } from "next/server"
import { getSession, requireAdminOrEmployee, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { applyCount, cancelCount, countForClient, countFolio, getCount } from "@/lib/domain/counts"
import { businessFailure } from "@/lib/domain/http"

/** Detalle de una sesión de conteo con sus items y producto. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const businessId = businessIdOf(getSession(auth)!)
    const { id } = await params

    const count = await getCount(prisma, businessId, id)
    if (!count) return NextResponse.json({ error: "Conteo no encontrado." }, { status: 404 })
    const blindOpen = count.blind && count.status === "OPEN"
    return NextResponse.json(
      {
        count: {
          // Conteo ciego en captura: items salen con expectedQty = null.
          ...countForClient(count),
          folio: countFolio(count.number),
          diffCount: blindOpen ? null : count.items.filter(i => i.countedQty !== i.expectedQty).length,
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    return businessFailure(error)
  }
}

/** Acciones del conteo: { action: "apply" | "cancel" }. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)
    const { id } = await params
    const body = await request.json()
    // Las transiciones ya son idempotentes por estado; la llave solo protege reintentos de red.
    const idempotencyKey = body.idempotencyKey ?? request.headers.get("idempotency-key") ?? crypto.randomUUID()

    if (body.action === "apply") {
      const result = await applyCount(prisma, session.user.id, businessId, id, { idempotencyKey })
      return NextResponse.json(result)
    }
    if (body.action === "cancel") {
      const result = await cancelCount(prisma, session.user.id, businessId, id, { idempotencyKey })
      return NextResponse.json(result)
    }
    return NextResponse.json({ error: "Acción inválida: usa apply o cancel." }, { status: 400 })
  } catch (error) {
    return businessFailure(error)
  }
}
