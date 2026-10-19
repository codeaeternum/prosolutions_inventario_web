import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { delegateRepairToPartner } from "@/lib/domain/delegation"
import { businessFailure } from "@/lib/domain/http"
import { operationKeySchema } from "@/lib/domain/operations"

// Delegación saliente: una orden PROPIA del taller se envía al negocio
// reparador configurado (SystemSettings["repair_partner_business_id"] del
// captador). El dominio crea la orden espejo en el tenant reparador y marca
// la local como EXTERNAL_LAB delegada — el cobro al cliente va por POS y el
// trabajo se gestiona en el portal aliado (/aliado).
const delegateSchema = z.object({
  partnerPriceCents: z.number().int().min(0).max(100000000).optional(),
  note: z.string().trim().max(500).optional(),
  idempotencyKey: operationKeySchema.optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModule("taller")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    // Delegar copia PII del cliente a OTRO tenant, compromete el precio
    // convenio (cuenta por pagar real) y congela la orden local sin reversa:
    // solo ADMIN — el dominio además lo exige antes de crear la espejo
    // (misma barrera que REFUND/ROTATE_UPLOAD_TOKEN).
    if (session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Solo el administrador puede enviar órdenes al taller asociado." }, { status: 403 })
    }
    const { id } = await params
    const body = delegateSchema.parse(await req.json().catch(() => ({})))
    const result = await delegateRepairToPartner(prisma, session.user.id, businessIdOf(session), id, body)
    return NextResponse.json({
      delegated: result.delegated,
      mirrorFolio: result.mirrorFolio,
      mirrorOrderId: result.mirrorOrderId,
      partnerName: result.partnerName,
    })
  } catch (error) { return businessFailure(error) }
}
