import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { AdminShell } from "@/components/admin/admin-shell"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session || session.user.status !== "APPROVED" || (session.user.role !== "ADMIN" && session.user.role !== "EMPLOYEE")) {
    redirect("/login")
  }

  // Sucursal base del usuario: fallback inicial del selector de sucursal.
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { homeBranchId: true },
  })

  return (
    <AdminShell user={session.user} homeBranchId={dbUser?.homeBranchId}>
      {children}
    </AdminShell>
  )
}
