import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireMarketplaceViewer } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { createRepair } from "@/lib/domain/workshop"
import { businessFailure } from "@/lib/domain/http"
import { operationKeySchema } from "@/lib/domain/operations"
import { getBusinessSetting } from "@/lib/settings"
import { DEFAULT_ORDER_PREFIX, formatFolio, repairLabels } from "@/lib/workshop-labels"

// Intake de talleres aliados CON cuenta (fase B del modelo "Telcel trae →
// nosotros reparamos"): un usuario del negocio aliado captura el equipo
// directo en el tenant del taller reparador. El vínculo aliado→reparador se
// configura con SystemSettings["repair_partner_business_id"] DEL ALIADO —
// así un despliegue puede tener varios aliados apuntando a distintos talleres.
// El flujo de mostrador (aliado sin cuenta) sigue por /admin/taller/recibir.
const REPAIR_PARTNER_KEY = "repair_partner_business_id"

// Espejo de los campos esenciales de createSchema (dominio): el intake del
// aliado no captura firma, bloqueo ni anticipo — la recepción física la
// completa el taller cuando el equipo llega.
const intakeSchema = z.object({
  customerName: z.string().trim().min(1).max(500),
  customerPhone: z.string().trim().min(7).max(30).regex(/^[+\d\s()-]+$/),
  equipmentType: z.string().trim().min(1).max(500),
  brand: z.string().trim().max(500).optional(),
  model: z.string().trim().max(500).optional(),
  reportedIssue: z.string().trim().min(1).max(500),
  partnerPriceCents: z.number().int().min(0).max(100000000).optional(),
  originContact: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: operationKeySchema.optional(),
})

export async function GET() {
  try {
    const auth = await requireMarketplaceViewer()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const partnerBusinessId = businessIdOf(session)
    // Las órdenes que este negocio originó como aliado. customerPhone viaja
    // porque el aliado mismo lo capturó de su cliente — no es fuga de datos.
    const orders = await prisma.repairOrder.findMany({
      where: { originBusinessId: partnerBusinessId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      select: {
        businessId: true, number: true, status: true,
        customerName: true, customerPhone: true,
        equipmentType: true, brand: true, model: true, reportedIssue: true,
        createdAt: true, promisedAt: true,
      },
    })
    // El folio se imprime con el order_prefix del taller reparador (dueño de
    // la orden), no del aliado — se resuelve por tenant de cada orden.
    const prefixes = new Map(await Promise.all(
      [...new Set(orders.map(order => order.businessId))].map(async id =>
        [id, await getBusinessSetting(id, "order_prefix").catch(() => null)] as const),
    ))
    return NextResponse.json({
      orders: orders.map(order => ({
        number: order.number,
        folio: formatFolio(prefixes.get(order.businessId) || DEFAULT_ORDER_PREFIX, order.number),
        status: order.status,
        statusLabel: repairLabels[order.status] ?? order.status,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        equipmentType: order.equipmentType,
        brand: order.brand,
        model: order.model,
        reportedIssue: order.reportedIssue,
        createdAt: order.createdAt,
        promisedAt: order.promisedAt,
      })),
    }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return businessFailure(error) }
}

export async function POST(req: Request) {
  try {
    const auth = await requireMarketplaceViewer()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const partnerBusinessId = businessIdOf(session)
    const body = intakeSchema.parse(await req.json())

    const link = await prisma.systemSettings.findUnique({
      where: { businessId_key: { businessId: partnerBusinessId, key: REPAIR_PARTNER_KEY } },
      select: { value: true },
    })
    const repairerBusinessId = link?.value?.trim()
    if (!repairerBusinessId) {
      return NextResponse.json({ error: "Este negocio no tiene taller asociado configurado" }, { status: 400 })
    }

    const [partnerBusiness, repairerBusiness, branch, repairerActor] = await Promise.all([
      prisma.business.findUnique({ where: { id: partnerBusinessId }, select: { name: true } }),
      prisma.business.findUnique({ where: { id: repairerBusinessId }, select: { isActive: true } }),
      // Sucursal de intake del reparador: su primera sucursal activa (el
      // equipo llega físicamente después; el taller lo reubica si hace falta).
      prisma.branch.findFirst({ where: { businessId: repairerBusinessId, isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } }),
      // Actor del recibo de operación: la operación exige un usuario staff
      // (ADMIN/EMPLOYEE) DEL tenant reparador. El usuario del aliado no puede
      // ser actor (pertenece a otro tenant y puede tener rol WORKSHOP), así
      // que el primer staff habilitado del taller funge como actor del recibo
      // — la captura real queda auditada en createdById/eventos/origen.
      prisma.user.findFirst({ where: { businessId: repairerBusinessId, status: "APPROVED", role: { in: ["ADMIN", "EMPLOYEE"] } }, orderBy: { createdAt: "asc" }, select: { id: true } }),
    ])
    if (!repairerBusiness?.isActive) {
      return NextResponse.json({ error: "El taller asociado no está disponible." }, { status: 400 })
    }
    if (!branch) {
      return NextResponse.json({ error: "El taller asociado no tiene una sucursal activa para recibir equipos." }, { status: 409 })
    }
    if (!repairerActor) {
      return NextResponse.json({ error: "El taller asociado no tiene personal habilitado para registrar la orden." }, { status: 409 })
    }

    const result = await createRepair(prisma, repairerActor.id, repairerBusinessId, {
      idempotencyKey: body.idempotencyKey ?? `partner-${randomUUID()}`,
      customerName: body.customerName,
      customerPhone: body.customerPhone,
      equipmentType: body.equipmentType,
      brand: body.brand,
      model: body.model,
      reportedIssue: body.reportedIssue,
      intakeBranchId: branch.id,
      originBusinessId: partnerBusinessId,
      originBusinessName: partnerBusiness?.name?.trim() || undefined,
      // "Quién lo trajo": el usuario del aliado que capturó + el contacto
      // extra que haya escrito (mostrador/teléfono del negocio). Tope del
      // campo: 120 caracteres (createSchema).
      originContact: [session.user.name, body.originContact].filter(Boolean).join(" · ").slice(0, 120) || undefined,
      partnerPriceCents: body.partnerPriceCents,
      // createdById = el usuario del aliado (recordedById): él capturó el
      // equipo y es la auditoría real de "Recibió". notes viaja como evento
      // interno — el rastreo público del cliente nunca lo expone.
    }, { recordedById: session.user.id, privateNote: body.notes ? `Nota del negocio aliado: ${body.notes}` : undefined })
    return NextResponse.json(result, { status: 201 })
  } catch (error) { return businessFailure(error) }
}
