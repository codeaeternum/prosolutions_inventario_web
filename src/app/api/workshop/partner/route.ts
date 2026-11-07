import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireMarketplaceViewer, type ApiSession } from "@/lib/api-auth"
import { hasModule } from "@/lib/access"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { createRepair } from "@/lib/domain/workshop"
import { businessFailure } from "@/lib/domain/http"
import { operationKeySchema } from "@/lib/domain/operations"
import { resolveRepairPartner } from "@/lib/domain/delegation"
import { getBusinessSetting } from "@/lib/settings"
import { checkAndRecord } from "@/lib/rate-limit"
import { DEFAULT_ORDER_PREFIX, formatFolio, parseFolioDigits, repairLabels } from "@/lib/workshop-labels"

// Intake de talleres aliados CON cuenta (fase B del modelo "Telcel trae →
// nosotros reparamos"): un usuario del negocio aliado captura el equipo
// directo en el tenant del taller reparador. El vínculo aliado→reparador se
// configura con SystemSettings["repair_partner_business_id"] DEL ALIADO —
// así un despliegue puede tener varios aliados apuntando a distintos talleres.
// El flujo de mostrador (aliado sin cuenta) sigue por /admin/taller/recibir,
// y la delegación de una orden propia va por /api/workshop/[id]/delegar.

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
  // Requerida (sin fallback aleatorio): un reintento de red con llave propia
  // debe devolver la misma orden — antes un retry duplicaba la captura.
  // El portal /aliado ya la manda (getClientOperationKey).
  idempotencyKey: operationKeySchema,
})

// El actor natural del intake es el rol WORKSHOP del negocio captador
// (portal /aliado): requireModule("taller") lo excluiría — exige
// ADMIN/EMPLOYEE vía requireAdminOrEmployee. En su lugar se exige capacidad
// de taller O mercado: un staff con módulos explícitos sin ninguno de los
// dos no capta ni lista órdenes en otro tenant (era cualquier staff).
// WORKSHOP/ADMIN y las listas vacías pasan igual que dicta hasModule.
function assertPartnerModule(session: ApiSession): NextResponse | null {
  if (hasModule(session.user, "taller") || hasModule(session.user, "mercado")) return null
  return NextResponse.json({ error: "No tienes acceso a este módulo." }, { status: 403 })
}

const PARTNER_POST_WINDOW_MS = 60 * 60 * 1000
const MAX_PARTNER_POSTS = 30 // capturas por hora por usuario — el flujo real es manual

export async function GET() {
  try {
    const auth = await requireMarketplaceViewer()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const deniedModule = assertPartnerModule(session)
    if (deniedModule) return deniedModule
    const partnerBusinessId = businessIdOf(session)
    // Las órdenes que este negocio originó como aliado. customerPhone viaja
    // porque el aliado mismo lo capturó de su cliente — no es fuga de datos.
    const orders = await prisma.repairOrder.findMany({
      where: { originBusinessId: partnerBusinessId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      select: {
        id: true, businessId: true, number: true, status: true,
        customerName: true, customerPhone: true,
        equipmentType: true, brand: true, model: true, reportedIssue: true,
        createdAt: true, promisedAt: true,
        // El aliado comparte el link de rastreo con SU cliente: necesita el
        // token (solo lectura pública; sin él el link caería al formato
        // enumerable folio+4 dígitos).
        trackingToken: true,
      },
    })
    // El folio se imprime con el order_prefix y los dígitos del taller
    // reparador (dueño de la orden), no del aliado — se resuelven por tenant.
    const folioFmt = new Map(await Promise.all(
      [...new Set(orders.map(order => order.businessId))].map(async id => {
        const [prefix, digitsRaw] = await Promise.all([
          getBusinessSetting(id, "order_prefix").catch(() => null),
          getBusinessSetting(id, "order_folio_digits").catch(() => null),
        ])
        return [id, { prefix: prefix || DEFAULT_ORDER_PREFIX, digits: parseFolioDigits(digitsRaw) }] as const
      }),
    ))
    return NextResponse.json({
      orders: orders.map(order => ({
        // id va en la respuesta: el detalle de una orden delegada lo usa
        // para empatar delegatedOrderId con su espejo y mostrar el estado
        // en vivo (la delegación saliente vive en /admin/taller).
        id: order.id,
        number: order.number,
        folio: (() => { const fmt = folioFmt.get(order.businessId); return formatFolio(fmt?.prefix ?? DEFAULT_ORDER_PREFIX, order.number, fmt?.digits) })(),
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
        trackingToken: order.trackingToken,
      })),
    }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return businessFailure(error) }
}

export async function POST(req: Request) {
  try {
    const auth = await requireMarketplaceViewer()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const deniedModule = assertPartnerModule(session)
    if (deniedModule) return deniedModule
    // Tope por usuario autenticado: la captura es un flujo manual de
    // mostrador — 30/hora cubre con holgura un local muy activo.
    if (!checkAndRecord("workshop-partner", session.user.id, PARTNER_POST_WINDOW_MS, MAX_PARTNER_POSTS)) {
      return NextResponse.json({ error: "Demasiadas capturas. Intenta de nuevo en una hora." }, { status: 429 })
    }
    const partnerBusinessId = businessIdOf(session)
    const body = intakeSchema.parse(await req.json())

    // El vínculo aliado→reparador y las validaciones del taller viven en el
    // dominio (src/lib/domain/delegation.ts): los comparte con la delegación
    // saliente de una orden propia.
    const partner = await resolveRepairPartner(prisma, partnerBusinessId)

    const result = await createRepair(prisma, partner.repairerActor.id, partner.repairerBusinessId, {
      idempotencyKey: body.idempotencyKey,
      customerName: body.customerName,
      customerPhone: body.customerPhone,
      equipmentType: body.equipmentType,
      brand: body.brand,
      model: body.model,
      reportedIssue: body.reportedIssue,
      intakeBranchId: partner.branch.id,
      originBusinessId: partnerBusinessId,
      originBusinessName: partner.partnerBusiness?.name?.trim() || undefined,
      // "Quién lo trajo": el usuario del aliado que capturó + el contacto
      // extra que haya escrito (mostrador/teléfono del negocio). Tope del
      // campo: 120 caracteres (createSchema).
      originContact: [session.user.name, body.originContact].filter(Boolean).join(" · ").slice(0, 120) || undefined,
      partnerPriceCents: body.partnerPriceCents,
      // createdById = el usuario del aliado (recordedById): él capturó el
      // equipo y es la auditoría real de "Recibió". notes viaja como evento
      // interno — el rastreo público del cliente nunca lo expone.
    }, { recordedById: session.user.id, privateNote: body.notes ? `Nota del negocio aliado: ${body.notes}` : undefined })
    // Respuesta whitelist: el aliado solo necesita folio + link de rastreo
    // para compartir con su cliente. La orden completa (quoteToken,
    // uploadToken, location, deliveredToDoc, PII de custodia) jamás sale al
    // OTRO tenant — antes `result` se devolvía entera.
    const [prefix, digitsRaw] = await Promise.all([
      getBusinessSetting(partner.repairerBusinessId, "order_prefix").catch(() => null),
      getBusinessSetting(partner.repairerBusinessId, "order_folio_digits").catch(() => null),
    ])
    return NextResponse.json({
      order: {
        id: result.order.id,
        number: result.order.number,
        folio: formatFolio(prefix, result.order.number, parseFolioDigits(digitsRaw)),
        status: result.order.status,
        trackingToken: result.order.trackingToken ?? null,
      },
      operationId: result.operationId,
    }, { status: 201 })
  } catch (error) { return businessFailure(error) }
}
