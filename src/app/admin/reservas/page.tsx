import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import ReservationsList from "@/components/admin/ReservationsList"
import { Pagination } from "@/components/ui/pagination"
import { Button } from "@/components/ui/button"
import { Breadcrumbs } from "@/components/admin/breadcrumbs"
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
    <div className="min-h-screen bg-muted/30 pb-12">
      <header className="bg-card border-b border-border shadow-sm mb-6">
        <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Gestión de Reservas 📦</h1>
            <p className="mt-1 text-sm text-muted-foreground">Valida pagos y entregas pendientes</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" className="gap-2 shrink-0">
              <Link href="/admin/verificar">
                <QrCode className="h-4 w-4" />
                Escanear reserva
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="text-primary hover:underline">
              <Link href="/admin">← Volver al Panel</Link>
            </Button>
          </div>
        </div>
      </header>

      <main id="main-content" className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8" role="main">
        <div className="px-4 py-6 sm:px-0 space-y-4">
          <Breadcrumbs items={[{ label: "Reservas" }]} />
          {reservations.length === 0 ? (
            <EmptyState 
              icon={Package} 
              title="No hay reservas recientes" 
              description="Las reservas realizadas por los clientes aparecerán aquí." 
            />
          ) : (
            <>
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
            </>
          )}
        </div>
      </main>
    </div>
  )
}
