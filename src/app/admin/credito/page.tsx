import { redirect } from "next/navigation"
import { requireAdmin } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { formatPrice, formatDate } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Users, DollarSign, ArrowUpRight, ArrowDownRight, Activity } from "lucide-react"

export default async function CreditoPage() {
  const adminCheck = await requireAdmin()
  if (adminCheck.error) redirect("/login")

  // 1. Métricas Globales
  const totalDebtAgg = await prisma.user.aggregate({
    _sum: { creditBalance: true },
    where: { creditBalance: { gt: 0 } },
  })
  const totalDebt = totalDebtAgg._sum.creditBalance || 0

  const activeClientsCount = await prisma.user.count({
    where: { creditBalance: { gt: 0 } },
  })

  // Pagos este mes
  const firstDayOfMonth = new Date()
  firstDayOfMonth.setDate(1)
  firstDayOfMonth.setHours(0, 0, 0, 0)
  
  const monthPaymentsAgg = await prisma.creditMovement.aggregate({
    _sum: { amount: true },
    where: {
      type: "PAYMENT",
      createdAt: { gte: firstDayOfMonth }
    }
  })
  const monthPayments = monthPaymentsAgg._sum.amount || 0

  // 2. Clientes con deuda
  const activeDebtors = await prisma.user.findMany({
    where: { creditBalance: { gt: 0 } },
    select: { id: true, name: true, phone: true, creditLimit: true, creditBalance: true },
    orderBy: { creditBalance: 'desc' },
    take: 20
  })

  // 3. Últimos movimientos
  const recentMovements = await prisma.creditMovement.findMany({
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 30
  })

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Módulo de Crédito y Cartera</h1>
        <p className="text-muted-foreground mt-1">Supervisa saldos deudores, abonos y estado de cuentas de tus clientes.</p>
      </div>

      {/* Tarjetas de Métricas */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total por Cobrar</CardTitle>
            <DollarSign className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatPrice(totalDebt)}</div>
            <p className="text-xs text-muted-foreground">Capital en la calle</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Clientes Deudores</CardTitle>
            <Users className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeClientsCount}</div>
            <p className="text-xs text-muted-foreground">Con saldo mayor a $0</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Abonos del Mes</CardTitle>
            <Activity className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{formatPrice(monthPayments)}</div>
            <p className="text-xs text-muted-foreground">Recuperado este mes</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Tabla Deudores */}
        <Card>
          <CardHeader>
            <CardTitle>Cartera Activa</CardTitle>
            <CardDescription>Clientes que actualmente deben saldo</CardDescription>
          </CardHeader>
          <CardContent>
            {activeDebtors.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No hay clientes con deuda pendiente.</p>
            ) : (
              <div className="space-y-4">
                {activeDebtors.map(user => {
                  const percentage = user.creditLimit ? (user.creditBalance! / user.creditLimit) * 100 : 0;
                  return (
                    <div key={user.id} className="flex items-center justify-between p-3 border rounded-lg bg-card hover:bg-muted/50 transition-colors">
                      <div>
                        <p className="font-semibold text-sm">{user.name}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Límite: {user.creditLimit ? formatPrice(user.creditLimit) : 'Sin límite'}
                        </p>
                        {user.creditLimit && user.creditLimit > 0 && (
                          <div className="w-full bg-secondary h-1.5 mt-2 rounded-full overflow-hidden">
                            <div 
                              className={`h-full ${percentage > 90 ? 'bg-destructive' : percentage > 75 ? 'bg-warning' : 'bg-primary'}`} 
                              style={{ width: `${Math.min(percentage, 100)}%` }} 
                            />
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-destructive">{formatPrice(user.creditBalance || 0)}</p>
                        <div className="flex gap-2 justify-end mt-1">
                          <a href={`/admin/usuarios?search=${encodeURIComponent(user.name)}`} className="text-[10px] text-blue-500 hover:underline">Ver usuario</a>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tabla Movimientos */}
        <Card>
          <CardHeader>
            <CardTitle>Últimos Movimientos</CardTitle>
            <CardDescription>Registro de créditos y abonos recientes</CardDescription>
          </CardHeader>
          <CardContent>
            {recentMovements.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No hay movimientos recientes.</p>
            ) : (
              <div className="space-y-3">
                {recentMovements.map(mov => {
                  const isDebt = mov.type === 'DEBT';
                  return (
                    <div key={mov.id} className="flex items-center gap-3 p-3 border-b last:border-0 pb-3">
                      <div className={`p-2 rounded-full ${isDebt ? 'bg-destructive/10 text-destructive' : 'bg-green-500/10 text-green-500'}`}>
                        {isDebt ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between items-start">
                          <p className="text-sm font-semibold">{mov.user.name}</p>
                          <div className="text-right">
                            <p className={`text-sm font-bold ${isDebt ? 'text-destructive' : 'text-green-600'}`}>
                              {isDebt ? '+' : '-'}{formatPrice(mov.amount)}
                            </p>
                            {!isDebt && (
                              <a href={`/admin/tickets/abono/${mov.id}`} target="_blank" rel="noreferrer" className="text-[10px] text-blue-500 hover:underline">
                                Ver ticket
                              </a>
                            )}
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 flex justify-between">
                          <span>{mov.notes || (isDebt ? 'Cargo' : 'Abono')}</span>
                          <span>{formatDate(mov.createdAt.toISOString())}</span>
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}