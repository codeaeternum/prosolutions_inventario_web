import { NextResponse } from "next/server"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

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
    const { status, customerType, role, homeBranchId } = body

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
    if (role && !["ADMIN", "CUSTOMER"].includes(role)) {
      return NextResponse.json(
        { error: "Rol inválido" },
        { status: 400 }
      )
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(status && { status }),
        ...(customerType && { customerType }),
        ...(role && { role }),
        ...(homeBranchId !== undefined && { homeBranchId: homeBranchId || null }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        customerType: true,
        role: true,
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
