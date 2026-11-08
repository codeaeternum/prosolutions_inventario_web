import { NextResponse } from "next/server"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"

// Barrido acotado por request: el dedupe en memoria cubre a los aliados con
// actividad reciente; más allá del tope el catálogo se corta — un aliado que
// no ha traído equipos en las últimas 2000 órdenes no hace falta autocompletarlo.
const ALLY_SCAN_CAP = 2000
const ALLY_LIMIT = 100

// Catálogo de aliados "de mostrador" (partnerDrop): nombres DISTINCT de
// RepairOrder.originBusinessName para autocompletar la recepción — nombre del
// negocio que trae el equipo y el originContact ("quién lo trajo") usado más
// recientemente con ese nombre. Se resuelve con un findMany ordenado desc +
// dedupe en memoria: groupBy por un campo no indexado costaría el mismo
// escaneo y no daría el "último contacto no vacío".
export async function GET() {
  try {
    const auth = await requireModule("taller")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const rows = await prisma.repairOrder.findMany({
      where: { businessId: businessIdOf(session), originBusinessName: { not: null } },
      select: { originBusinessName: true, originContact: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: ALLY_SCAN_CAP,
    })
    // Orden cronológico inverso: el primer contacto NO vacío de cada nombre
    // es el más reciente "usado" — una orden nueva sin dato no lo borra.
    const byName = new Map<string, { name: string; lastContact: string | null; orderCount: number }>()
    for (const row of rows) {
      const name = row.originBusinessName?.trim()
      if (!name) continue
      const ally = byName.get(name) ?? { name, lastContact: null, orderCount: 0 }
      ally.orderCount += 1
      const contact = row.originContact?.trim()
      if (ally.lastContact == null && contact) ally.lastContact = contact
      byName.set(name, ally)
    }
    const aliados = [...byName.values()]
      .sort((a, b) => b.orderCount - a.orderCount || a.name.localeCompare(b.name, "es"))
      .slice(0, ALLY_LIMIT)
    return NextResponse.json({ aliados }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return businessFailure(error) }
}
