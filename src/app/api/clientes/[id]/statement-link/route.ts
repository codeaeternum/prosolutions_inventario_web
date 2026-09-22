import { NextResponse } from "next/server"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { rotatedStatementToken, statementExpired } from "@/lib/customer-statement"

// Link público del estado de cuenta (/cuenta/<token>): el cliente lo recibe
// por WhatsApp desde la ficha 360 y consulta saldo/movimientos sin login.
// El token es la frontera de seguridad — nunca viaja businessId por query.
const NO_STORE = { "Cache-Control": "private, no-store" } as const

/**
 * POST: emite el link. Siempre ROTA el token — cada envío genera una URL
 * nueva con 30 días de vigencia y los links compartidos antes mueren (si un
 * WhatsApp quedó en el chat equivocado, reenviar revoca el anterior).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await requireModule("clientes")
    if (result.error) return result.error
    const businessId = businessIdOf(getSession(result)!)

    const { id } = await params
    const customer = await prisma.user.findFirst({
      where: { id, businessId, role: "CUSTOMER" },
      select: { id: true, business: { select: { name: true } } },
    })
    if (!customer) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })

    const tokenFields = rotatedStatementToken()
    await prisma.user.update({ where: { id: customer.id }, data: tokenFields })

    return NextResponse.json(
      {
        // Path relativo: el cliente arma la URL con window.location.origin.
        url: `/cuenta/${tokenFields.statementToken}`,
        expiresAt: tokenFields.statementTokenExpiresAt,
        // El negocio del staff, para el texto de WhatsApp ("en <negocio>").
        businessName: customer.business.name,
      },
      { headers: NO_STORE }
    )
  } catch (error) {
    console.error("Error generating statement link:", error)
    return NextResponse.json({ error: "Error al generar el enlace" }, { status: 500 })
  }
}

/**
 * GET: consulta el link vigente sin rotarlo (null si nunca se emitió o ya
 * venció — para reenviar hay que usar POST).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await requireModule("clientes")
    if (result.error) return result.error
    const businessId = businessIdOf(getSession(result)!)

    const { id } = await params
    const customer = await prisma.user.findFirst({
      where: { id, businessId, role: "CUSTOMER" },
      select: { statementToken: true, statementTokenExpiresAt: true },
    })
    if (!customer) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })

    if (!customer.statementToken || statementExpired(customer.statementTokenExpiresAt)) {
      return NextResponse.json({ url: null, expiresAt: null }, { headers: NO_STORE })
    }
    return NextResponse.json(
      { url: `/cuenta/${customer.statementToken}`, expiresAt: customer.statementTokenExpiresAt },
      { headers: NO_STORE }
    )
  } catch (error) {
    console.error("Error fetching statement link:", error)
    return NextResponse.json({ error: "Error al consultar el enlace" }, { status: 500 })
  }
}
