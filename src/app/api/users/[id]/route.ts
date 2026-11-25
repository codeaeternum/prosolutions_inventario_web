import { NextResponse } from "next/server"
import { z } from "zod"
import type { Prisma } from "@/generated/prisma/client"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { resolveWorkshopSlug } from "../slug-utils"
import { MODULES } from "@/lib/access"
import { diffChanges, listText, recordAudit } from "@/lib/audit"
import { BusinessError, transaction } from "@/lib/domain/operations"
import bcrypt from "bcryptjs"

// Restricciones de acceso del staff: lista vacía = sin restricción.
const accessSchema = z.object({
  allowedModules: z.array(z.enum(MODULES)).max(MODULES.length).optional(),
  allowedBranchIds: z.array(z.string().min(1)).max(100).optional(),
})

// Estatus y tipo de cliente viajan por enum estricto: antes se aplicaban
// crudos del body y un valor fuera de catálogo llegaba a Prisma como 500.
// `suspensionReason` no es columna de User: solo acompaña a un cambio a
// REJECTED y vive en el detalle del evento de bitácora.
const accountSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  customerType: z.enum(["NORMAL", "TECHNICIAN", "STORE"]).optional(),
  suspensionReason: z.string().trim().max(200).optional(),
  newPassword: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(128).optional(),
})

// Esquema de pago del staff (solo ADMIN lo escribe): un solo tipo en v1 —
// payRateCents es tarifa/hora (HOURLY) o sueldo por quincena (SALARY) y
// commissionPct el % sobre ventas cobradas (COMMISSION). null limpia el dato.
const paySchema = z.object({
  payType: z.enum(["NONE", "HOURLY", "SALARY", "COMMISSION"]).optional(),
  payRateCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  commissionPct: z.number().min(0).max(100).nullable().optional(),
})

// Relaciones del User que cuentan como historial: los Cascade pierden datos
// al borrar la cuenta (crédito, reservas, checadas) y los Restrict abortan
// el delete con P2003 → 500. Fuera quedan solo las efímeras que sí pueden
// irse con la cuenta (códigos de verificación, lecturas de notificaciones).
const USER_HISTORY_COUNT = {
  creditMovements: true,
  reservations: true,
  encargosAsCustomer: true,
  encargosCreated: true,
  encargosResolved: true,
  salesMade: true,
  salesAsCustomer: true,
  paymentsMade: true,
  supplierPayments: true,
  auditEvents: true,
  businessOperations: true,
  assignedRepairs: true,
  createdRepairs: true,
  deliveredRepairs: true,
  customerRepairs: true,
  repairParts: true,
  repairPartsDecided: true,
  repairEvents: true,
  repairPhotos: true,
  cashRegistersOpened: true,
  cashRegistersClosed: true,
  cashMovements: true,
  cashRequestsRequested: true,
  cashRequestsDecided: true,
  purchases: true,
  inventoryCounts: true,
  shoppingItemsCreated: true,
  shoppingItemsResolved: true,
  movements: true,
  priceChanges: true,
  marketplaceRequested: true,
  marketplaceDecided: true,
  clockEvents: true,
} as const

/** Frases "N <tipo>" de la razón por la que la cuenta no puede borrarse. */
function userHistoryBlockers(counts: Partial<Record<keyof typeof USER_HISTORY_COUNT, number>> = {}): string[] {
  const n = (key: keyof typeof USER_HISTORY_COUNT) => counts[key] ?? 0
  const buckets: Array<[number, string]> = [
    [n("creditMovements"), "movimiento(s) de crédito"],
    [n("reservations") + n("encargosAsCustomer") + n("encargosCreated") + n("encargosResolved"), "reserva(s) o encargo(s)"],
    [n("salesMade") + n("salesAsCustomer"), "venta(s)"],
    [n("paymentsMade") + n("supplierPayments"), "pago(s)"],
    [
      n("assignedRepairs") + n("createdRepairs") + n("deliveredRepairs") + n("customerRepairs") +
      n("repairParts") + n("repairPartsDecided") + n("repairEvents") + n("repairPhotos"),
      "registro(s) de taller",
    ],
    [
      n("cashRegistersOpened") + n("cashRegistersClosed") + n("cashMovements") +
      n("cashRequestsRequested") + n("cashRequestsDecided"),
      "movimiento(s) de caja",
    ],
    [
      n("purchases") + n("inventoryCounts") + n("shoppingItemsCreated") + n("shoppingItemsResolved") +
      n("movements") + n("priceChanges"),
      "registro(s) de inventario",
    ],
    [n("marketplaceRequested") + n("marketplaceDecided"), "solicitud(es) del mercado"],
    [n("clockEvents"), "checada(s) de asistencia"],
    [n("auditEvents") + n("businessOperations"), "evento(s) de historial"],
  ]
  return buckets.filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`)
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await requireModule("usuarios")
    if (result.error) return result.error
    const session = getSession(result)!
    const businessId = businessIdOf(session)
    const isAdmin = session.user.role === "ADMIN"

    const { id } = await params
    const body = await req.json()
    const { status, customerType, role, homeBranchId, jobTitle, quickPin, publicSlug } = body

    const existingUser = await prisma.user.findUnique({
      where: { id, businessId },
      // El select amplio alimenta el diff de la bitácora (antes→después).
      select: {
        id: true,
        name: true,
        status: true,
        customerType: true,
        role: true,
        isSuperAdmin: true,
        homeBranchId: true,
        jobTitle: true,
        publicSlug: true,
        allowedModules: true,
        allowedBranchIds: true,
        payType: true,
        payRateCents: true,
        commissionPct: true,
      },
    })
    if (!existingUser) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
    }

    // Solo un ADMIN toca a otro ADMIN o asigna el rol: un empleado con el
    // módulo de usuarios gestiona personal pero no escala privilegios.
    if (!isAdmin && (existingUser.role === "ADMIN" || role === "ADMIN")) {
      return NextResponse.json({ error: "Solo un administrador puede gestionar administradores" }, { status: 403 })
    }

    // Un empleado con el módulo jamás se edita a sí mismo por esta vía: su
    // perfil (nombre/correo/teléfono) va por /api/perfil y TODOS los campos
    // que este endpoint escribe son administrativos — permitirlo abriría
    // auto-escalación de módulos, rol, PIN o estatus.
    if (!isAdmin && session.user.id === id) {
      return NextResponse.json({ error: "No puedes gestionar tu propia cuenta" }, { status: 403 })
    }

    // Rol, estatus, tipo de cliente, módulos/sucursales permitidas, esquema
    // de pago, PIN rápido y contraseña son exclusivos del ADMIN. El empleado solo
    // ajusta puesto, sucursal base y el slug público del taller (campos operativos).
    if (!isAdmin && (
      role !== undefined ||
      status !== undefined ||
      customerType !== undefined ||
      body.suspensionReason !== undefined ||
      body.newPassword !== undefined ||
      quickPin !== undefined ||
      body.allowedModules !== undefined ||
      body.allowedBranchIds !== undefined ||
      body.payType !== undefined ||
      body.payRateCents !== undefined ||
      body.commissionPct !== undefined
    )) {
      return NextResponse.json({ error: "Solo un administrador puede cambiar rol, estatus, módulos, esquema de pago o PIN" }, { status: 403 })
    }

    if (body.newPassword !== undefined && existingUser.isSuperAdmin && !session.user.isSuperAdmin) {
      return NextResponse.json(
        { error: "No puedes cambiar la contraseña de un superadministrador" },
        { status: 403 }
      )
    }

    const accessParsed = accessSchema.safeParse({ allowedModules: body.allowedModules, allowedBranchIds: body.allowedBranchIds })
    if (!accessParsed.success) {
      return NextResponse.json({ error: "Módulos o sucursales inválidos" }, { status: 400 })
    }
    const { allowedModules, allowedBranchIds } = accessParsed.data

    // Enum estricto para estatus y tipo de cliente (400 en vez de un 500
    // de Prisma cuando llegaba un valor inventado).
    const accountParsed = accountSchema.safeParse({
      status,
      customerType,
      suspensionReason: body.suspensionReason,
      newPassword: body.newPassword,
    })
    if (!accountParsed.success) {
      const firstIssue = accountParsed.error.issues[0]
      const msg =
        firstIssue?.path[0] === "newPassword"
          ? firstIssue.message
          : "Estatus, tipo de cliente o motivo de suspensión inválidos"
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    const { status: statusUpdate, customerType: customerTypeUpdate, newPassword } = accountParsed.data
    // "" (tras trim) equivale a no enviar motivo.
    const suspensionReason = accountParsed.data.suspensionReason || undefined

    const payParsed = paySchema.safeParse({
      payType: body.payType,
      payRateCents: body.payRateCents,
      commissionPct: body.commissionPct,
    })
    if (!payParsed.success) {
      return NextResponse.json({ error: "Esquema de pago inválido" }, { status: 400 })
    }
    const { payType: payTypeUpdate, payRateCents: payRateUpdate, commissionPct: commissionUpdate } = payParsed.data

    if (allowedBranchIds?.length) {
      const owned = await prisma.branch.count({ where: { id: { in: allowedBranchIds }, businessId } })
      if (owned !== allowedBranchIds.length) {
        return NextResponse.json({ error: "Alguna sucursal no pertenece al negocio" }, { status: 400 })
      }
    }

    // Puesto del staff: string de hasta 60 caracteres; vacío/null lo limpia.
    let jobTitleUpdate: string | null | undefined
    if (jobTitle !== undefined) {
      const clean = typeof jobTitle === "string" ? jobTitle.trim() : ""
      if (clean.length > 60) {
        return NextResponse.json({ error: "El puesto no puede exceder 60 caracteres" }, { status: 400 })
      }
      jobTitleUpdate = clean || null
    }

    // PIN rápido: "" o null -> conservar; "CLEAR" -> quitar; 4-6 dígitos -> reemplazar.
    let quickPinUpdate: string | null | undefined
    if (quickPin === "CLEAR") {
      quickPinUpdate = null
    } else if (typeof quickPin === "string" && quickPin !== "") {
      if (!/^\d{4,6}$/.test(quickPin)) {
        return NextResponse.json({ error: "El PIN rápido debe tener de 4 a 6 dígitos" }, { status: 400 })
      }
      quickPinUpdate = await bcrypt.hash(quickPin, 12)
    }

    let passwordUpdate: string | undefined
    if (newPassword !== undefined) {
      passwordUpdate = await bcrypt.hash(newPassword, 12)
    }

    if (homeBranchId) {
      const branch = await prisma.branch.findUnique({ where: { id: homeBranchId, businessId } })
      if (!branch || !branch.isActive) {
        return NextResponse.json({ error: "Sucursal inválida" }, { status: 400 })
      }
    }

    // Prevent admin from demoting themselves
    if (role && role !== "ADMIN" && session.user.id === id) {
      return NextResponse.json(
        { error: "No puedes quitarte el rol de administrador a ti mismo" },
        { status: 400 }
      )
    }

    // Prevent admin from suspending or deactivating their own account
    if (statusUpdate && statusUpdate !== "APPROVED" && session.user.id === id) {
      return NextResponse.json(
        { error: "No puedes suspender tu propia cuenta" },
        { status: 400 }
      )
    }

    // Validate role if provided
    if (role && !["ADMIN", "EMPLOYEE", "CUSTOMER", "WORKSHOP"].includes(role)) {
      return NextResponse.json(
        { error: "Rol inválido" },
        { status: 400 }
      )
    }

    // Link público: solo aplica al rol efectivo WORKSHOP. Si el rol cambia a
    // otro o el campo llega vacío, el slug se limpia a null.
    const targetRole = role ?? existingUser.role
    let publicSlugUpdate: string | null | undefined
    if (targetRole === "WORKSHOP") {
      if (publicSlug !== undefined) {
        const resolved = await resolveWorkshopSlug(publicSlug, businessId, id)
        if (resolved instanceof NextResponse) return resolved
        publicSlugUpdate = resolved
      }
    } else {
      publicSlugUpdate = null
    }

    const user = await prisma.user.update({
      where: { id, businessId },
      data: {
        ...(statusUpdate && { status: statusUpdate }),
        ...(customerTypeUpdate && { customerType: customerTypeUpdate }),
        ...(role && { role }),
        ...(homeBranchId !== undefined && { homeBranchId: homeBranchId || null }),
        ...(jobTitleUpdate !== undefined && { jobTitle: jobTitleUpdate }),
        ...(quickPinUpdate !== undefined && { quickPin: quickPinUpdate }),
        ...(passwordUpdate !== undefined && { password: passwordUpdate }),
        ...(publicSlugUpdate !== undefined && { publicSlug: publicSlugUpdate }),
        ...(allowedModules !== undefined && { allowedModules }),
        ...(allowedBranchIds !== undefined && { allowedBranchIds }),
        ...(payTypeUpdate !== undefined && { payType: payTypeUpdate }),
        ...(payRateUpdate !== undefined && { payRateCents: payRateUpdate }),
        ...(commissionUpdate !== undefined && { commissionPct: commissionUpdate }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        customerType: true,
        role: true,
        jobTitle: true,
        publicSlug: true,
        homeBranchId: true,
        allowedModules: true,
        allowedBranchIds: true,
        // La respuesta lleva el esquema de pago solo al ADMIN: el mismo
        // endpoint sirve al empleado que edita campos operativos.
        ...(isAdmin ? { payType: true, payRateCents: true, commissionPct: true } : {}),
      },
    })

    // Bitácora: antes→después de los campos administrables. JAMÁS se
    // registra password/quickPin (ni el campo): el PIN solo se anota como
    // "actualizado"/"eliminado" en el resumen, sin valor.
    const auditBefore = {
      estatus: existingUser.status,
      tipoCliente: existingUser.customerType,
      rol: existingUser.role,
      sucursalId: existingUser.homeBranchId,
      puesto: existingUser.jobTitle,
      slugPublico: existingUser.publicSlug,
      modulos: existingUser.allowedModules,
      sucursales: existingUser.allowedBranchIds,
      esquemaPago: existingUser.payType,
    }
    const auditAfter = {
      estatus: user.status,
      tipoCliente: user.customerType,
      rol: user.role,
      sucursalId: user.homeBranchId,
      puesto: user.jobTitle,
      slugPublico: user.publicSlug,
      modulos: user.allowedModules,
      sucursales: user.allowedBranchIds,
      esquemaPago: payTypeUpdate ?? existingUser.payType,
    }
    let changes: Record<string, Prisma.InputJsonValue> | null = diffChanges(auditBefore, auditAfter, Object.keys(auditAfter))
    // Tarifa y % se auditan solo como "cambió el esquema de pago": la
    // bitácora no guarda importes de sueldo.
    const payChanged =
      (payTypeUpdate !== undefined && payTypeUpdate !== existingUser.payType) ||
      (payRateUpdate !== undefined && payRateUpdate !== existingUser.payRateCents) ||
      (commissionUpdate !== undefined && commissionUpdate !== existingUser.commissionPct)
    // El motivo solo tiene sentido cuando el cambio deja la cuenta
    // suspendida; con otro estatus se descarta aunque llegue en el body.
    const motivoSuspension = statusUpdate === "REJECTED" ? suspensionReason : undefined
    if (changes || quickPinUpdate !== undefined || passwordUpdate !== undefined || payChanged || motivoSuspension) {
      const parts: string[] = []
      if (changes?.rol) parts.push(`Rol ${auditBefore.rol} → ${auditAfter.rol}`)
      if (changes?.estatus) parts.push(`Estatus ${auditBefore.estatus} → ${auditAfter.estatus}`)
      if (changes?.tipoCliente) parts.push(`Tipo de cliente ${auditBefore.tipoCliente} → ${auditAfter.tipoCliente}`)
      if (changes?.puesto) parts.push(`Puesto "${auditBefore.puesto ?? "—"}" → "${auditAfter.puesto ?? "—"}"`)
      if (changes?.sucursalId) parts.push("Cambió la sucursal base")
      if (changes?.slugPublico) parts.push("Cambió el link público del taller")
      if (changes?.modulos) parts.push(`Módulos: ${listText(auditBefore.modulos, "todos")} → ${listText(auditAfter.modulos, "todos")}`)
      if (changes?.sucursales) parts.push(`Sucursales: ${listText(auditBefore.sucursales, "todas")} → ${listText(auditAfter.sucursales, "todas")}`)
      if (quickPinUpdate !== undefined) parts.push(quickPinUpdate === null ? "PIN rápido eliminado" : "PIN rápido actualizado")
      if (passwordUpdate !== undefined) {
        parts.push("Contraseña restablecida")
        ;(changes ??= {}).contraseñaRestablecida = true
      }
      if (motivoSuspension) {
        parts.push(`Motivo: "${motivoSuspension}"`)
        // Va también al detalle machine-readable del evento (User no tiene
        // columna para persistirlo).
        ;(changes ??= {}).motivoSuspension = { before: null as unknown as Prisma.InputJsonValue, after: motivoSuspension }
      }
      if (payChanged) {
        parts.push(
          changes?.esquemaPago
            ? `Esquema de pago ${auditBefore.esquemaPago} → ${auditAfter.esquemaPago}`
            : "Cambió la tarifa o comisión del esquema de pago"
        )
      }
      await recordAudit(prisma, {
        businessId,
        actorId: session.user.id,
        action: "USER_UPDATE",
        entity: "user",
        entityId: id,
        entityName: existingUser.name,
        summary: parts.join(" · ") || "Editó al usuario",
        changes,
      })
    }

    return NextResponse.json(user)
  } catch (error) {
    console.error("Error updating user:", error)
    return NextResponse.json({ error: "Error al actualizar usuario" }, { status: 500 })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await requireModule("usuarios")
    if (result.error) return result.error
    const session = getSession(result)!

    // Solo un ADMIN elimina usuarios: borrar cuentas con historial (ventas,
    // reservas, crédito) es irreversible y no es facultad del mostrador.
    if (session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Solo un administrador puede eliminar usuarios" }, { status: 403 })
    }

    const { id } = await params

    if (session.user.id === id) {
      return NextResponse.json(
        { error: "No puedes eliminar tu propia cuenta" },
        { status: 400 }
      )
    }

    const businessId = businessIdOf(session)

    // Una cuenta con historial NUNCA se borra: CreditMovement, Reservation y
    // ClockEvent cuelgan del usuario con onDelete: Cascade (borrar la cuenta
    // quemaría el ledger financiero y la asistencia) y una quincena de
    // relaciones más son Restrict (el delete caía en P2003 → 500). El _count
    // se lee DENTRO de la tx serializable: un movimiento nacido a mitad del
    // delete aborta con el mismo 409, no se lleva nada en cascade.
    let deleted: { name: string; role: string }
    try {
      deleted = await transaction(prisma, async tx => {
        const target = await tx.user.findUnique({
          where: { id, businessId },
          select: { name: true, role: true, _count: { select: USER_HISTORY_COUNT } },
        })
        if (!target) throw new BusinessError("Usuario no encontrado", 404)
        const blockers = userHistoryBlockers(target._count)
        if (blockers.length > 0) {
          throw new BusinessError(
            `No se puede eliminar a "${target.name}": tiene ${blockers.join(", ")}. Suspende la cuenta en su lugar.`,
            409,
          )
        }
        await tx.user.delete({ where: { id, businessId } })
        return target
      })
    } catch (error) {
      if (error instanceof BusinessError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : ""
      // La guarda cubre todas las FKs conocidas; una nueva relación Restrict
      // futura aborta el delete y aun así responde 409, nunca 500.
      if (code === "P2003" || code === "P2014") {
        return NextResponse.json(
          { error: "No se puede eliminar: la cuenta tiene registros vinculados. Suspende la cuenta en su lugar." },
          { status: 409 },
        )
      }
      if (code === "P2025") {
        return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
      }
      throw error
    }

    await recordAudit(prisma, {
      businessId,
      actorId: session.user.id,
      action: "USER_DELETE",
      entity: "user",
      entityId: id,
      entityName: deleted.name,
      summary: `Eliminó al usuario "${deleted.name}" · Rol ${deleted.role}`,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting user:", error)
    return NextResponse.json({ error: "Error al eliminar usuario" }, { status: 500 })
  }
}
