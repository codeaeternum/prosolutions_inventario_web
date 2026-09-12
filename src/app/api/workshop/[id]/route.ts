import { NextResponse } from "next/server"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { updateRepair } from "@/lib/domain/workshop"
import { businessFailure } from "@/lib/domain/http"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const { id } = await params
    const order = await prisma.repairOrder.findUnique({ where: { id }, include: { currentBranch: true, intakeBranch: true, assignedTo: { select: { id: true, name: true } }, events: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 200, include: { actor: { select: { name: true } } } }, parts: { include: { createdBy: { select: { name: true } }, product: { select: { id: true, name: true, barcode: true } } }, orderBy: { createdAt: "asc" } } } })
    return NextResponse.json(order ? { order } : { error: "Orden no encontrada" }, { status: order ? 200 : 404, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return businessFailure(error) }
}
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const { id } = await params
    return NextResponse.json(await updateRepair(prisma, getSession(auth)!.user.id, id, await req.json()))
  } catch (error) { return businessFailure(error) }
}
