import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { AdminShell } from "@/components/admin/admin-shell"
import { getBusinessSetting } from "@/lib/settings"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session || session.user.status !== "APPROVED" || (session.user.role !== "ADMIN" && session.user.role !== "EMPLOYEE")) {
    redirect("/login")
  }

  // Consultamos en paralelo la sucursal base, el tipo de negocio y el vínculo de taller aliado.
  const [dbUser, partnerLink] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        homeBranchId: true,
        business: { select: { businessKind: true } },
      },
    }),
    session.user.businessId
      ? getBusinessSetting(session.user.businessId, "repair_partner_business_id")
      : Promise.resolve(null),
  ])

  return (
    <AdminShell
      user={session.user}
      homeBranchId={dbUser?.homeBranchId}
      hasPartner={Boolean(partnerLink)}
      businessKind={dbUser?.business?.businessKind}
    >
      {children}
    </AdminShell>
  )
}
