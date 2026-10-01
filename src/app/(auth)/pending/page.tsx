import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { PendingCard } from "./pending-card"

/**
 * /pending — cuentas que aún no operan.
 *
 * Tres casos:
 * - ADMIN + PENDING: dueño auto-registrado (/api/signup) → lo manda a
 *   /verificar; su cuenta se activa sola al confirmar correo o teléfono.
 * - APPROVED en BD pero el JWT dice PENDING (se verificó con la sesión
 *   vieja): aviso + botón que rehace el login vía /post-login.
 * - CUSTOMER/WORKSHOP + PENDING: esperando aprobación del negocio.
 */
export const dynamic = "force-dynamic"

export default async function PendingPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { status: true, role: true },
  })

  if (user?.status === "PENDING" && user.role === "ADMIN") {
    redirect("/verificar?sent=1")
  }

  return <PendingCard alreadyApproved={user?.status === "APPROVED"} />
}
