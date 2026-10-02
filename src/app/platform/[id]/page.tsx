import type { Metadata } from "next"
import { cache } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { getPlatformBusinessDetail } from "@/lib/platform"
import { repairLabels } from "@/lib/workshop-labels"
import { formatDate, formatDay, formatPrice } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { BusinessStatusButton } from "@/components/platform/business-status-button"
import { BusinessDeleteButton } from "@/components/platform/business-delete-button"
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  MapPin,
  Package,
  Phone,
  ShoppingCart,
  Users,
  Warehouse,
  Wrench,
} from "lucide-react"

export const dynamic = "force-dynamic"

interface PageProps {
  params: Promise<{ id: string }>
}

// cache() deduplica por request: generateMetadata + page comparten la consulta.
const getDetail = cache(getPlatformBusinessDetail)

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  const business = await getDetail(id)
  return {
    title: business ? business.name : "Empresa",
    robots: { index: false, follow: false },
  }
}

const roleLabels: Record<string, string> = {
  ADMIN: "Administrador",
  EMPLOYEE: "Empleado",
  CUSTOMER: "Cliente",
  WORKSHOP: "Taller aliado",
}

const userStatusLabels: Record<string, string> = {
  APPROVED: "Aprobado",
  PENDING: "Pendiente",
  REJECTED: "Rechazado",
}

const platformEventLabels: Record<string, string> = {
  TENANT_SUSPENDED: "Empresa suspendida",
  TENANT_REACTIVATED: "Empresa reactivada",
  TENANT_DELETED: "Empresa eliminada",
}

const userStatusVariants: Record<string, "success" | "warning" | "destructive"> = {
  APPROVED: "success",
  PENDING: "warning",
  REJECTED: "destructive",
}

const saleStatusLabels: Record<string, string> = {
  COMPLETED: "Completada",
  VOIDED: "Anulada",
}

export default async function PlatformBusinessPage({ params }: PageProps) {
  const { id } = await params
  const business = await getDetail(id)
  if (!business) notFound()

  const metrics = [
    { title: "Usuarios", value: business.counts.users, icon: Users },
    { title: "Productos", value: business.counts.products, icon: Package },
    { title: "Órdenes de servicio", value: business.counts.repairOrders, icon: Wrench },
    { title: "Ventas", value: business.counts.sales, icon: ShoppingCart },
    { title: "Sucursales", value: business.counts.branches, icon: Warehouse },
  ]

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 gap-2">
        <Link href="/platform">
          <ArrowLeft className="h-4 w-4" />
          Empresas
        </Link>
      </Button>

      {/* Encabezado de la empresa */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
          <div className="flex items-center gap-4 min-w-0">
            {business.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={business.logoUrl}
                alt={`Logo de ${business.name}`}
                className="h-14 w-14 rounded-lg object-cover border shrink-0"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-muted shrink-0">
                <Building2 className="h-7 w-7 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-2xl font-bold tracking-tight truncate">{business.name}</h2>
                <Badge variant={business.isActive ? "success" : "destructive"}>
                  {business.isActive ? "Activa" : "Suspendida"}
                </Badge>
                <Badge variant="outline">{business.category}</Badge>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {business.isActive ? (
                  <Link
                    href={`/${business.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline font-mono"
                  >
                    /{business.slug}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                ) : (
                  <span className="font-mono">/{business.slug}</span>
                )}
                <span>Registro: {formatDay(business.createdAt)}</span>
                {business.phone && (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="h-3.5 w-3.5" /> {business.phone}
                  </span>
                )}
                {business.address && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" /> {business.address}
                  </span>
                )}
              </div>
            </div>
          </div>
          <BusinessStatusButton business={business} variant={business.isActive ? "destructive" : "default"} />
        </CardContent>
      </Card>

      {/* Métricas */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        {metrics.map(m => (
          <Card key={m.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{m.title}</CardTitle>
              <span className="rounded-lg bg-primary/10 p-2 text-primary shrink-0">
                <m.icon className="h-4 w-4" />
              </span>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">{m.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Ventas acumuladas</CardTitle>
            <CardDescription>Suma de ventas completadas</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">{formatPrice(business.salesTotal)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Última actividad</CardTitle>
            <CardDescription>Orden o venta más reciente</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {business.lastActivityAt ? formatDay(business.lastActivityAt) : "Sin actividad"}
            </div>
            {business.lastActivityAt && (
              <p className="text-xs text-muted-foreground">{formatDate(business.lastActivityAt)}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Actividad reciente */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              Últimas órdenes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {business.recentRepairOrders.length > 0 ? (
              <div className="space-y-3">
                {business.recentRepairOrders.map(o => (
                  <div key={o.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                    <div>
                      <p className="font-medium font-mono">{o.folio}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(o.createdAt)}</p>
                    </div>
                    <div className="text-right">
                      <Badge variant="secondary">
                        {repairLabels[o.status as keyof typeof repairLabels] ?? o.status}
                      </Badge>
                      <p className="text-sm font-medium mt-1 tabular-nums">
                        {o.totalCents !== null ? formatPrice(o.totalCents / 100) : "—"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">Sin órdenes registradas.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" />
              Últimas ventas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {business.recentSales.length > 0 ? (
              <div className="space-y-3">
                {business.recentSales.map(s => (
                  <div key={s.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                    <div>
                      <p className="font-medium font-mono">{s.folio}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(s.createdAt)}</p>
                    </div>
                    <div className="text-right">
                      <Badge variant={s.status === "VOIDED" ? "destructive" : "secondary"}>
                        {saleStatusLabels[s.status] ?? s.status}
                      </Badge>
                      <p className="text-sm font-medium mt-1 tabular-nums">{formatPrice(s.total)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">Sin ventas registradas.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Equipo */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Usuarios del equipo
          </CardTitle>
          <CardDescription>
            Staff con acceso al panel (los {business.counts.users} usuarios incluyen también clientes).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {business.users.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Correo</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Registro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {business.users.map(u => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {u.name}
                          {u.isSuperAdmin && (
                            <Badge variant="default" className="ml-2">Plataforma</Badge>
                          )}
                        </span>
                        {u.jobTitle && (
                          <span className="text-xs text-muted-foreground">{u.jobTitle}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{u.email ?? "—"}</TableCell>
                    <TableCell>{roleLabels[u.role] ?? u.role}</TableCell>
                    <TableCell>
                      <Badge variant={userStatusVariants[u.status] ?? "secondary"}>
                        {userStatusLabels[u.status] ?? u.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {formatDay(u.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground">Sin usuarios de staff.</p>
          )}
        </CardContent>
      </Card>

      {/* Bitácora de plataforma: suspend/reactivate/delete quedan aquí —
          el evento sobrevive aunque el negocio se borre (sin FK). */}
      {business.platformEvents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Historial de plataforma</CardTitle>
            <CardDescription>Acciones del operador sobre este negocio.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {business.platformEvents.map(ev => (
                <li key={ev.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    {platformEventLabels[ev.kind] ?? ev.kind}
                    <span className="text-muted-foreground"> · {ev.actorEmail ?? "operador"}</span>
                  </span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(ev.createdAt)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Zona de peligro: solo para altas vacías (prueba/broma); con datos
          operativos el servidor rechaza el borrado y toca suspender. */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-destructive">Zona de peligro</CardTitle>
          <CardDescription>
            Eliminar borra la empresa y sus datos semilla de forma permanente.
            Solo procede si el negocio nunca operó.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BusinessDeleteButton business={{ id: business.id, name: business.name }} />
        </CardContent>
      </Card>
    </div>
  )
}
