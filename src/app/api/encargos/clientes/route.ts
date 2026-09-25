import { NextResponse, type NextRequest } from "next/server"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"
import { normalizePhone } from "@/lib/utils"

/**
 * Buscador de clientes para ligar un encargo a una cuenta. A diferencia de
 * /api/clientes (módulo clientes/taller), aquí basta el módulo inventario:
 * quien registra encargos no necesariamente opera el directorio de clientes.
 * Devuelve lo mínimo para elegir: id, nombre y teléfono.
 *
 * GET /api/encargos/clientes?q=
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const businessId = businessIdOf(getSession(auth)!)

    const q = (new URL(request.url).searchParams.get("q") ?? "").trim()
    if (q.length < 2) return NextResponse.json({ customers: [] })

    // El teléfono está normalizado a dígitos: un término numérico busca por
    // esos dígitos (igual que recepción de taller con /api/clientes).
    const digits = normalizePhone(q)
    const customers = await prisma.user.findMany({
      where: {
        businessId,
        role: "CUSTOMER",
        status: "APPROVED",
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { businessName: { contains: q, mode: "insensitive" } },
          ...(digits ? [{ phone: { contains: digits } }] : []),
        ],
      },
      select: { id: true, name: true, phone: true, customerType: true },
      orderBy: { name: "asc" },
      take: 8,
    })
    return NextResponse.json({ customers }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return businessFailure(error)
  }
}
