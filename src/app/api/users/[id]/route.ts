import { NextResponse } from "next/server"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { resolveWorkshopSlug } from "../slug-utils"
import { MODULES } from "@/lib/access"
import { diffChanges, listText, recordAudit } from "@/lib/audit"
import { deleteOrphanedPaymentProofs } from "@/lib/payment-proofs"
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
})

// Esquema de pago del staff (solo ADMIN lo escribe): un solo tipo en v1 —
// payRateCents es tarifa/hora (HOURLY) o sueldo por quincena (SALARY) y
// commissionPct el % sobre ventas cobradas (COMMISSION). null limpia el dato.
const paySchema = z.object({
  payType: z.enum(["NONE", "HOURLY", "SALARY", "COMMISSION"]).optional(),
  payRateCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  commissionPct: z.number().min(0).max(100).nullable().optional(),
})

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
    // de pago y PIN rápido son exclusivos del ADMIN. El empleado solo ajusta
    // puesto, sucursal base y el slug público del taller (campos operativos).
    if (!isAdmin && (
      role !== undefined ||
      status !== undefined ||
      customerType !== undefined ||
      body.suspensionReason !== undefined ||
      quickPin !== undefined ||
      body.allowedModules !== undefined ||
      body.allowedBranchIds !== undefined ||
      body.payType !== undefined ||
      body.payRateCents !== undefined ||
      body.commissionPct !== undefined
    )) {
      return NextResponse.json({ error: "Solo un administrador puede cambiar rol, estatus, módulos, esquema de pago o PIN" }, { status: 403 })
    }

    const accessParsed = accessSchema.safeParse({ allowedModules: body.allowedModules, allowedBranchIds: body.allowedBranchIds })
    if (!accessParsed.success) {
      return NextResponse.json({ error: "Módulos o sucursales inválidos" }, { status: 400 })
    }
    const { allowedModules, allowedBranchIds } = accessParsed.data

    // Enum estricto para estatus y tipo de cliente (400 en vez de un 500
    // de Prisma cuando llegaba un valor inventado).
    const accountParsed = accountSchema.safeParse({ status, customerType, suspensionReason: body.suspensionReason })
    if (!accountParsed.success) {
      return NextResponse.json({ error: "Estatus, tipo de cliente o motivo de suspensión inválidos" }, { status: 400 })
    }
    const { status: statusUpdate, customerType: customerTypeUpdate } = accountParsed.data
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
    let changes = diffChanges(auditBefore, auditAfter, Object.keys(auditAfter))
    // Tarifa y % se auditan solo como "cambió el esquema de pago": la
    // bitácora no guarda importes de sueldo.
    const payChanged =
      (payTypeUpdate !== undefined && payTypeUpdate !== existingUser.payType) ||
      (payRateUpdate !== undefined && payRateUpdate !== existingUser.payRateCents) ||
      (commissionUpdate !== undefined && commissionUpdate !== existingUser.commissionPct)
    // El motivo solo tiene sentido cuando el cambio deja la cuenta
    // suspendida; con otro estatus se descarta aunque llegue en el body.
    const motivoSuspension = statusUpdate === "REJECTED" ? suspensionReason : undefined
    if (changes || quickPinUpdate !== undefined || payChanged || motivoSuspension) {
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

    const businessId = businessIdOf(session)
    const target = await prisma.user.findUnique({ where: { id, businessId }, select: { role: true, name: true } })

    // La FK Reservation.userId es Cascade: borrar la cuenta se lleva también
    // sus reservas — se recolectan sus comprobantes para limpiar archivos
    // post-commit (solo si ya ninguna otra fila los referencia).
    const proofUrls = (await prisma.reservation.findMany({
      where: { userId: id, businessId, paymentProofUrl: { not: null } },
      select: { paymentProofUrl: true },
    })).map(row => row.paymentProofUrl)

    await prisma.user.delete({
      where: { id, businessId },
    })

    await deleteOrphanedPaymentProofs(prisma, proofUrls)

    await recordAudit(prisma, {
      businessId,
      actorId: session.user.id,
      action: "USER_DELETE",
      entity: "user",
      entityId: id,
      entityName: target?.name ?? null,
      summary: `Eliminó al usuario "${target?.name ?? id}"${target ? ` · Rol ${target.role}` : ""}`,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting user:", error)
    return NextResponse.json({ error: "Error al eliminar usuario" }, { status: 500 })
  }
}
