import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { getPlatformHealth } from "@/lib/platform-health"
import { formatDate, formatPrice } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Activity,
  ArrowLeft,
  Building2,
  HeartPulse,
  ShieldAlert,
  ShoppingCart,
  Store,
  UserCheck,
  Users,
  Wrench,
} from "lucide-react"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Salud global",
  robots: { index: false, follow: false },
}

export default async function PlatformHealthPage() {
  // El layout ya filtra superadmins; el guard se repite aquí por defensa,
  // igual que requireSuperAdmin protege /api/platform/health.
  const session = await auth()
  if (!session?.user?.isSuperAdmin) redirect("/")

  const health = await getPlatformHealth()

  // Top scopes del rate-limiter para la tarjeta de 429 (memoria del proceso).
  const rateLimitTop = Object.entries(health.rateLimits.byRoute)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([scope, n]) => `${scope}: ${n}`)
    .join(" · ")

  const kpis = [
    {
      title: "Empresas",
      value: health.businesses.total,
      sub: `${health.businesses.active} activas · ${health.businesses.suspended} suspendidas`,
      icon: Building2,
    },
    {
      title: "Usuarios",
      value: health.users.total,
      sub: `${health.users.staff} staff · ${health.users.customers} clientes`,
      icon: Users,
    },
    {
      title: "Ventas completadas",
      value: health.sales.totalCompleted,
      sub: `${formatPrice(health.sales.totalRevenueCents / 100)} acumulados`,
      icon: ShoppingCart,
    },
    {
      title: "Órdenes abiertas",
      value: health.repairs.openCount,
      sub: "En talleres de toda la plataforma",
      icon: Wrench,
    },
  ]

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 gap-2">
        <Link href="/platform">
          <ArrowLeft className="h-4 w-4" />
          Volver a la consola
        </Link>
      </Button>

      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <HeartPulse className="h-7 w-7 text-primary" aria-hidden="true" />
          Salud global
        </h1>
        <p className="text-muted-foreground">
          Métricas agregadas de toda la plataforma — sin datos de negocios individuales.
        </p>
      </div>

      {/* KPIs principales */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {kpis.map(m => (
          <Card key={m.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{m.title}</CardTitle>
              <span className="rounded-lg bg-primary/10 p-2 text-primary shrink-0">
                <m.icon className="h-4 w-4" />
              </span>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">{m.value}</div>
              <p className="text-xs text-muted-foreground">{m.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Señales secundarias */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="space-y-1.5">
              <CardTitle className="text-sm font-medium">En directorio</CardTitle>
              <CardDescription>Empresas activas visibles en /mercado</CardDescription>
            </div>
            <span className="rounded-lg bg-primary/10 p-2 text-primary shrink-0">
              <Store className="h-4 w-4" />
            </span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">{health.businesses.inDirectory}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="space-y-1.5">
              <CardTitle className="text-sm font-medium">Pendientes de aprobación</CardTitle>
              <CardDescription>Cuentas de usuario esperando aprobación</CardDescription>
            </div>
            <span className="rounded-lg bg-primary/10 p-2 text-primary shrink-0">
              <UserCheck className="h-4 w-4" />
            </span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">{health.users.pendingApproval}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="space-y-1.5">
              <CardTitle className="text-sm font-medium">Eventos de plataforma</CardTitle>
              <CardDescription>Acciones del operador registradas</CardDescription>
            </div>
            <span className="rounded-lg bg-primary/10 p-2 text-primary shrink-0">
              <Activity className="h-4 w-4" />
            </span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">{health.platformEvents.total}</div>
            <p className="text-xs text-muted-foreground">
              {health.platformEvents.lastAt
                ? `Último: ${formatDate(health.platformEvents.lastAt)}`
                : "Sin eventos registrados"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="space-y-1.5">
              <CardTitle className="text-sm font-medium">Peticiones limitadas</CardTitle>
              <CardDescription>Respuestas 429 del rate-limiter, últimas 24 h</CardDescription>
            </div>
            <span className="rounded-lg bg-primary/10 p-2 text-primary shrink-0">
              <ShieldAlert className="h-4 w-4" />
            </span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">{health.rateLimits.deniedLast24h}</div>
            <p className="text-xs text-muted-foreground">
              {rateLimitTop || "Sin rechazos · conteo de este proceso"}
            </p>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        Generado: {formatDate(health.generatedAt)}
      </p>
    </div>
  )
}
