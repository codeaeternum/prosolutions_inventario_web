import { NextResponse } from "next/server"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { resolveWorkshopSlug } from "../slug-utils"
import bcrypt from "bcryptjs"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await requireAdmin()
    if (result.error) return result.error
    const session = getSession(result)!

    const { id } = await params
    const body = await req.json()
    const { status, customerType, role, homeBranchId, jobTitle, quickPin, publicSlug } = body

    const existingUser = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    })
    if (!existingUser) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
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
      const branch = await prisma.branch.findUnique({ where: { id: homeBranchId } })
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
        const resolved = await resolveWorkshopSlug(publicSlug, id)
        if (resolved instanceof NextResponse) return resolved
        publicSlugUpdate = resolved
      }
    } else {
      publicSlugUpdate = null
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(status && { status }),
        ...(customerType && { customerType }),
        ...(role && { role }),
        ...(homeBranchId !== undefined && { homeBranchId: homeBranchId || null }),
        ...(jobTitleUpdate !== undefined && { jobTitle: jobTitleUpdate }),
        ...(quickPinUpdate !== undefined && { quickPin: quickPinUpdate }),
        ...(publicSlugUpdate !== undefined && { publicSlug: publicSlugUpdate }),
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
    const result = await requireAdmin()
    if (result.error) return result.error

    const { id } = await params

    await prisma.user.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting user:", error)
    return NextResponse.json({ error: "Error al eliminar usuario" }, { status: 500 })
  }
}
