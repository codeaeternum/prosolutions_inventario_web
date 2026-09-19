import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { resolveWorkshopSlug } from "../slug-utils"
import { MODULES } from "@/lib/access"
import bcrypt from "bcryptjs"

// Restricciones de acceso del staff: lista vacía = sin restricción.
const accessSchema = z.object({
  allowedModules: z.array(z.enum(MODULES)).max(MODULES.length).optional(),
  allowedBranchIds: z.array(z.string().min(1)).max(100).optional(),
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

    const { id } = await params
    const body = await req.json()
    const { status, customerType, role, homeBranchId, jobTitle, quickPin, publicSlug } = body

    const existingUser = await prisma.user.findUnique({
      where: { id, businessId },
      select: { id: true, role: true },
    })
    if (!existingUser) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
    }

    // Solo un ADMIN toca a otro ADMIN o asigna el rol: un empleado con el
    // módulo de usuarios gestiona personal pero no escala privilegios.
    if (session.user.role !== "ADMIN" && (existingUser.role === "ADMIN" || role === "ADMIN")) {
      return NextResponse.json({ error: "Solo un administrador puede gestionar administradores" }, { status: 403 })
    }

    const accessParsed = accessSchema.safeParse({ allowedModules: body.allowedModules, allowedBranchIds: body.allowedBranchIds })
    if (!accessParsed.success) {
      return NextResponse.json({ error: "Módulos o sucursales inválidos" }, { status: 400 })
    }
    const { allowedModules, allowedBranchIds } = accessParsed.data
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
        ...(status && { status }),
        ...(customerType && { customerType }),
        ...(role && { role }),
        ...(homeBranchId !== undefined && { homeBranchId: homeBranchId || null }),
        ...(jobTitleUpdate !== undefined && { jobTitle: jobTitleUpdate }),
        ...(quickPinUpdate !== undefined && { quickPin: quickPinUpdate }),
        ...(publicSlugUpdate !== undefined && { publicSlug: publicSlugUpdate }),
        ...(allowedModules !== undefined && { allowedModules }),
        ...(allowedBranchIds !== undefined && { allowedBranchIds }),
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
      },
    })

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

    const { id } = await params

    // Un empleado con el módulo no puede eliminar a un administrador.
    if (session.user.role !== "ADMIN") {
      const target = await prisma.user.findUnique({ where: { id, businessId: businessIdOf(session) }, select: { role: true } })
      if (target?.role === "ADMIN") {
        return NextResponse.json({ error: "Solo un administrador puede eliminar administradores" }, { status: 403 })
      }
    }

    await prisma.user.delete({
      where: { id, businessId: businessIdOf(session) },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting user:", error)
    return NextResponse.json({ error: "Error al eliminar usuario" }, { status: 500 })
  }
}
