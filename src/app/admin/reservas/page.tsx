import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { businessIdOf } from "@/lib/tenant"
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
  // Mostrador (admin|empleado): valida pagos y entrega reservas.
  if (!session || !["ADMIN", "EMPLOYEE"].includes(session.user?.role ?? "")) redirect("/")
  const businessId = businessIdOf(session)

  const params = await searchParams
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(params.limit ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT))

  const [reservationsRaw, total, layaways] = await Promise.all([
    prisma.reservation.findMany({
      where: { businessId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        user: true,
        product: true,
      },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.reservation.count({ where: { businessId } }),
    // Apartados de mostrador (OPEN LAYAWAY): multi-producto, creados en la
    // terminal POS, con anticipos parciales — conviven con las reservas del
    // catálogo público que sigue usando el modelo Reservation.
    prisma.sale.findMany({
      where: { businessId, kind: "LAYAWAY", status: "OPEN" },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        customer: { select: { name: true, phone: true } },
        items: { include: { product: { select: { name: true } } } },
        payments: { where: { status: "CONFIRMED" }, select: { amount: true } },
        branch: { select: { name: true } },
      },
    }),
  ])

  // Activas primero (lo que exige acción del staff), terminales al fondo.
  const statusPriority: Record<string, number> = {
    PENDING_PAYMENT: 1,
    PENDING: 2,
    DEPOSIT_VERIFIED: 3,
    APPROVED: 4,
    COMPLETED: 5,
    CANCELLED: 6,
    REJECTED: 7,
    EXPIRED: 8,
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

      {layaways.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Apartados de mostrador</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {layaways.map(doc => {
              const paid = doc.payments.reduce((sum, p) => sum + p.amount, 0)
              const balance = Math.max(0, doc.total - paid)
              const expired = doc.expiresAt && doc.expiresAt < new Date()
              return (
                <div key={doc.id} className="bg-card rounded-lg border border-border p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-semibold">A-{String(doc.number).padStart(6, "0")}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${expired ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                      {expired ? "Vencido" : "Activo"}
                    </span>
                  </div>
                  <p className="text-sm font-medium">{doc.customer?.name ?? "Sin cliente"}</p>
                  <p className="text-xs text-muted-foreground line-clamp-1">
                    {doc.items.map(i => `${i.quantity}× ${i.product.name}`).join(", ")}
                  </p>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{doc.branch?.name}</span>
                    <span className="font-semibold">Saldo: ${balance.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" className="flex-1" asChild>
                      <Link href={`/admin/tickets/venta/${doc.id}`} target="_blank">Ticket</Link>
                    </Button>
                    <Button size="sm" className="flex-1" asChild>
                      <Link href="/admin/ventas?apartados=1">Liquidar en POS</Link>
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

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
