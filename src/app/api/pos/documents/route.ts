import { NextResponse } from "next/server"
import { assertOperationBranch, getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { listDocuments, parkDocument } from "@/lib/domain/documents"
import { businessFailure } from "@/lib/domain/http"

const STATUSES = ["DRAFT", "OPEN", "COMPLETED", "VOIDED"] as const
const KINDS = ["RETAIL", "WORKSHOP", "LAYAWAY", "QUOTE"] as const

// Documentos vivos del mostrador: ventas suspendidas (DRAFT), cotizaciones
// (QUOTE) y apartados activos (OPEN LAYAWAY). El cajero los lista, retoma,
// cobra o cancela desde la terminal.
export async function GET(req: Request) {
  try {
    const auth = await requireModule("ventas")
    if (auth.error) return auth.error
    const query = new URL(req.url).searchParams
    const status = query.get("status") || undefined
    const kind = query.get("kind") || undefined
    const branchId = query.get("branchId") || undefined
    const customerId = query.get("customerId") || undefined
    if (status && !STATUSES.includes(status as (typeof STATUSES)[number])) return NextResponse.json({ error: "Estado inválido" }, { status: 400 })
    if (kind && !KINDS.includes(kind as (typeof KINDS)[number])) return NextResponse.json({ error: "Tipo inválido" }, { status: 400 })
    const documents = await listDocuments(prisma, businessIdOf(getSession(auth)!), {
      status: status as (typeof STATUSES)[number] | undefined,
      kind: kind as (typeof KINDS)[number] | undefined,
      branchId, customerId, limit: 50,
    })
    return NextResponse.json({ documents }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return businessFailure(error) }
}

export async function POST(req: Request) {
  try {
    const auth = await requireModule("ventas")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const body = await req.json()
    const denied = await assertOperationBranch(session, body?.branchId)
    if (denied) return denied
    const document = await parkDocument(prisma, session.user.id, businessIdOf(session), {
      ...body, idempotencyKey: body.idempotencyKey ?? req.headers.get("idempotency-key"),
    })
    return NextResponse.json({ document }, { status: 201 })
  } catch (error) { return businessFailure(error) }
}
