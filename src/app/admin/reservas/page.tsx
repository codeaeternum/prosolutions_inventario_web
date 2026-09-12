import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import ReservationsList from "@/components/admin/ReservationsList"
import { Pagination } from "@/components/ui/pagination"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/admin/empty-state"
import { Package, QrCode } from "lucide-react"

export const dynamic = "force-dynamic"

const DEFAULT_LIMIT = 20

export default async function AdminReservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; limit?: string }>
}) {
  const session = await auth()
  if (session?.user?.role !== "ADMIN") redirect("/")

  const params = await searchParams
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(params.limit ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT))

  const [reservationsRaw, total] = await Promise.all([
    prisma.reservation.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        user: true,
        product: true,
      },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.reservation.count(),
  ])

  const statusPriority: Record<string, number> = {
    PENDING_PAYMENT: 1,
    PENDING: 2,
    PAID: 3,
    COMPLETED: 4,
    CANCELLED: 5,
  }

  const reservations = [...reservationsRaw].sort((a, b) => {
    const priorityA = statusPriority[a.status] ?? 99
    const priorityB = statusPriority[b.status] ?? 99
    return priorityA - priorityB
  })

  const totalPages = Math.ceil(total / limit) || 1

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Reservas</h2>
          <p className="text-muted-foreground">Valida pagos y entregas pendientes</p>
        </div>
        <Button asChild className="gap-2 shrink-0">
          <Link href="/admin/verificar">
            <QrCode className="h-4 w-4" />
            Escanear reserva
          </Link>
        </Button>
      </div>

      {reservations.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No hay reservas recientes"
          description="Las reservas realizadas por los clientes aparecerán aquí."
        />
      ) : (
        <div className="space-y-4">
          <ReservationsList reservations={reservations} />
          <div className="bg-card rounded-lg shadow border border-border px-4 py-3">
            <Pagination
              page={page}
              limit={limit}
              total={total}
              totalPages={totalPages}
              query={{}}
            />
          </div>
        </div>
      )}
    </div>
  )
}
