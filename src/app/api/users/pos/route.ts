import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { hasModule } from "@/lib/access"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { recordAudit } from "@/lib/audit"
import { checkAndRecord } from "@/lib/rate-limit"
import { normalizePhone } from "@/lib/utils"

// Minimización de PII en el GET (invariante de seguridad, employee-permissions):
// el listado NO expone phone/email — el POST de alta sí hace eco del teléfono
// porque es el dato que el propio cajero acaba de capturar, no una lectura nueva.
const SELECT = { id: true, name: true, customerType: true, creditLimit: true, creditBalance: true } as const

/** Prisma P2002 (unique violado): el teléfono existe en OTRO tenant. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  )
}

/** Customer lookup for the POS: credit sale check (default), direct id
 *  preselect (?id=) from the 360 ficha, and ?all=1 for apartados/cotizaciones
 *  donde cualquier cliente aprobado aplica — no solo los que tienen crédito.
 *  Expone teléfono (búsqueda) y saldo/límite de crédito: exige el módulo
 *  ventas (POS) o clientes (ficha 360) — no cualquier staff. */
export async function GET(req: Request) {
  const result = await requireAdminOrEmployee()
  if (result.error) return result.error
  const session = getSession(result)!
  if (!hasModule(session.user, "ventas") && !hasModule(session.user, "clientes")) {
    return NextResponse.json({ error: "No tienes acceso a este módulo." }, { status: 403 })
  }
  const businessId = businessIdOf(session)
  const params = new URL(req.url).searchParams

  const id = params.get("id")?.trim()
  if (id) {
    const user = await prisma.user.findFirst({
      where: { id, businessId, role: "CUSTOMER", status: "APPROVED" },
      select: SELECT,
    })
    return NextResponse.json({ users: user ? [user] : [] }, { headers: { "Cache-Control": "private, no-store" } })
  }

  const search = params.get("search")?.trim() ?? ""
  if (search.length < 2 || search.length > 100) return NextResponse.json({ users: [] })
  const all = params.get("all") === "1"
  const users = await prisma.user.findMany({
    where: {
      businessId, role: "CUSTOMER", status: "APPROVED",
      ...(all ? {} : { creditLimit: { not: null } }),
      OR: [{ name: { contains: search, mode: "insensitive" } }, { phone: { contains: search } }],
    },
    select: SELECT,
    take: 8, orderBy: { name: "asc" },
  })
  return NextResponse.json({ users }, { headers: { "Cache-Control": "private, no-store" } })
}

const createSchema = z.object({
  name: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres").max(80, "El nombre no puede exceder 80 caracteres"),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
})

/**
 * Alta rápida de cliente de mostrador (POST /api/users/pos): nombre + teléfono
 * opcional, sin correo ni contraseña — el cliente nace APPROVED y NORMAL para
 * poder apartar/cotizar en el mismo cobro. El alta completa (correo, tipo de
 * cliente, crédito) sigue siendo del módulo de usuarios/clientes.
 *
 * Por qué no POST /api/users: esa ruta exige email + password y el módulo
 * "usuarios" — un cajero con solo "ventas" no puede dar de alta, y pedirle
 * inventar correo/contraseña en mostrador es exactamente la fricción que este
 * endpoint elimina. Permisos idénticos al GET de arriba (ventas o clientes).
 *
 * User.phone es único GLOBAL: si el teléfono ya existe en este negocio y es un
 * cliente aprobado se devuelve ESE cliente (alta idempotente — el cajero estaba
 * creando a la misma persona); si pertenece a otro usuario del negocio o a otro
 * tenant, 409 — jamás se reutiliza ni se filtra a quién pertenece.
 */
export async function POST(req: Request) {
  try {
    const result = await requireAdminOrEmployee()
    if (result.error) return result.error
    const session = getSession(result)!
    if (!hasModule(session.user, "ventas") && !hasModule(session.user, "clientes")) {
      return NextResponse.json({ error: "No tienes acceso a este módulo." }, { status: 403 })
    }
    const businessId = businessIdOf(session)

    if (!checkAndRecord("pos-customer-create", session.user.id, 15 * 60 * 1000, 20)) {
      return NextResponse.json(
        { error: "Demasiadas altas de cliente. Espera unos minutos." },
        { status: 429, headers: { "Retry-After": "900" } }
      )
    }

    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
        { status: 400 }
      )
    }
    const name = parsed.data.name
    // Igual que en registro: el teléfono se guarda normalizado (últimos 10
    // dígitos) para que el unique global y phoneNormalized empaten formatos.
    const phone = normalizePhone(parsed.data.phone) || null
    if (parsed.data.phone?.trim() && (!phone || phone.length < 7)) {
      return NextResponse.json({ error: "Revisa el teléfono: al menos 7 dígitos." }, { status: 400 })
    }

    if (phone) {
      // Mismo criterio que linkCustomerByPhone: el índice es phoneNormalized.
      const taken = await prisma.user.findFirst({
        where: { businessId, phoneNormalized: phone },
        select: { ...SELECT, role: true, status: true },
      })
      if (taken) {
        if (taken.role === "CUSTOMER" && taken.status === "APPROVED") {
          // Alta idempotente: el cliente ya existía (el buscador no lo
          // mostró por nombre distinto) — se selecciona en vez de duplicar.
          // Respuesta whitelist con la misma forma que un alta nueva.
          const user = {
            id: taken.id,
            name: taken.name,
            customerType: taken.customerType,
            // Eco del teléfono que el cajero acaba de capturar (el match fue
            // por ese mismo número) — no una lectura nueva de la base.
            phone,
            creditLimit: taken.creditLimit,
            creditBalance: taken.creditBalance,
          }
          return NextResponse.json({ user, existing: true }, { headers: { "Cache-Control": "private, no-store" } })
        }
        return NextResponse.json(
          { error: "Ese teléfono ya está registrado en el negocio. Busca al cliente por teléfono o pide al administrador que lo revise." },
          { status: 409 }
        )
      }
    }

    let user
    try {
      user = await prisma.user.create({
        data: {
          businessId,
          name,
          phone,
          phoneNormalized: phone,
          role: "CUSTOMER",
          customerType: "NORMAL",
          // Sin correo ni contraseña: la cuenta es de mostrador — si el
          // cliente quiere entrar al portal se completa desde usuarios.
          status: "APPROVED",
        },
        select: SELECT,
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        // El teléfono existe en OTRO tenant (unique global): no se revela
        // dónde — el cajero puede capturar sin teléfono y completar después.
        return NextResponse.json(
          { error: "No se pudo registrar con ese teléfono. Captura sin teléfono y completa el dato después." },
          { status: 409 }
        )
      }
      throw error
    }

    await recordAudit(prisma, {
      businessId,
      actorId: session.user.id,
      action: "USER_CREATE",
      entity: "user",
      entityId: user.id,
      entityName: user.name,
      summary: `Alta rápida de cliente "${user.name}" en mostrador`,
      changes: { origen: { before: null, after: "pos" } },
    })

    // El teléfono de la respuesta es el eco del dato capturado (SELECT no lo
    // expone en lecturas): el picker muestra el contacto recién creado sin
    // abrir el listado a PII que el cajero no capturó.
    return NextResponse.json({ user: { ...user, phone }, existing: false }, { status: 201, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    console.error("Error creating pos customer:", error)
    return NextResponse.json({ error: "Error al crear el cliente" }, { status: 500 })
  }
}
