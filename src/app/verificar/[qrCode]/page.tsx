import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { PriceDisplay } from "@/components/price-display"
import { CheckCircle, XCircle, Clock, AlertTriangle, Package } from "lucide-react"
import Image from "next/image"
import { VerifyActions } from "./verify-actions"

export const dynamic = "force-dynamic"

async function getReservation(code: string, businessId: string) {
  try {
    // Aceptar id (QR del bot) o qrCode (campo único de la reserva)
    return await prisma.reservation.findFirst({
      where: {
        businessId,
        OR: [{ id: code }, { qrCode: code }],
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            images: true,
            retailPrice: true,
            wholesalePrice: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            customerType: true,
          },
        },
      },
    })
  } catch {
    return null
  }
}

function getStatusInfo(status: string, isExpired: boolean) {
  if (isExpired && status !== "COMPLETED" && status !== "CANCELLED") {
    return {
      label: "Expirada",
      variant: "destructive" as const,
      icon: XCircle,
      color: "text-red-500",
    }
  }

  const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof CheckCircle; color: string }> = {
    PENDING_PAYMENT: { label: "Pago pendiente de validar", variant: "secondary", icon: Clock, color: "text-muted-foreground" },
    PENDING: { label: "Pendiente", variant: "secondary", icon: Clock, color: "text-muted-foreground" },
    DEPOSIT_VERIFIED: { label: "Depósito Verificado", variant: "default", icon: CheckCircle, color: "text-primary" },
    APPROVED: { label: "Aprobada", variant: "default", icon: CheckCircle, color: "text-primary" },
    REJECTED: { label: "Rechazada", variant: "destructive", icon: XCircle, color: "text-destructive" },
    COMPLETED: { label: "Completada", variant: "default", icon: CheckCircle, color: "text-primary" },
    CANCELLED: { label: "Cancelada", variant: "destructive", icon: XCircle, color: "text-muted-foreground" },
    EXPIRED: { label: "Expirada", variant: "destructive", icon: AlertTriangle, color: "text-destructive" },
  }

  return statusMap[status] || statusMap.PENDING
}

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ qrCode: string }>
}) {
  const { qrCode } = await params
  const session = await auth()

  // Solo staff del negocio (admin|empleado) puede verificar y entregar reservas
  if (!session || !["ADMIN", "EMPLOYEE"].includes(session.user.role) || session.user.status !== "APPROVED") {
    redirect("/login?callbackUrl=/verificar/" + qrCode)
  }

  const reservation = await getReservation(qrCode, businessIdOf(session))

  if (!reservation) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <main id="main-content" className="w-full max-w-md" role="main">
        <Card className="w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <XCircle className="h-10 w-10 text-destructive" />
            </div>
            <CardTitle className="text-2xl">Reserva no encontrada</CardTitle>
            <CardDescription>
              El código QR escaneado no corresponde a ninguna reserva válida.
            </CardDescription>
          </CardHeader>
        </Card>
        </main>
      </div>
    )
  }

  const isExpired = new Date(reservation.expiresAt) < new Date()
  const canComplete = ["PENDING", "APPROVED", "DEPOSIT_VERIFIED"].includes(reservation.status) && !isExpired && (reservation.type !== "DEPOSIT" || reservation.depositPaid)
  const statusInfo = getStatusInfo(reservation.status, isExpired)
  const StatusIcon = statusInfo.icon

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <main id="main-content" className="w-full max-w-lg" role="main">
      <Card className="w-full">
        <CardHeader className="text-center pb-2">
          <div className={`mx-auto mb-4 h-16 w-16 rounded-full flex items-center justify-center ${canComplete ? "bg-primary/10" : isExpired ? "bg-destructive/10" : "bg-muted"
            }`}>
            <StatusIcon className={`h-10 w-10 ${statusInfo.color}`} />
          </div>
          <div className="flex justify-center mb-2">
            <Badge variant={statusInfo.variant} className="text-sm">
              {statusInfo.label}
            </Badge>
          </div>
          <CardTitle className="text-xl">
            {canComplete ? "Listo para Entregar" : `Reserva ${statusInfo.label}`}
          </CardTitle>
          <CardDescription>
            Código: {qrCode.slice(-8).toUpperCase()}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Producto */}
          <div className="flex gap-4 p-4 bg-muted rounded-lg">
            <div className="w-20 h-20 relative rounded-md overflow-hidden bg-background flex-shrink-0">
              {reservation.product.images[0] ? (
                <Image
                  src={reservation.product.images[0]}
                  alt={reservation.product.name}
                  fill
                  sizes="80px"
                  className="object-cover"
                />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <Package className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-medium line-clamp-2">{reservation.product.name}</h3>
              <p className="text-sm text-muted-foreground">
                Cantidad: {reservation.quantity}
              </p>
              <p className="font-bold text-primary mt-1">
                <PriceDisplay price={reservation.totalPrice} />
              </p>
            </div>
          </div>

          {/* Cliente */}
          <div className="p-4 border rounded-lg">
            <h4 className="text-sm font-medium text-muted-foreground mb-2">Cliente</h4>
            <p className="font-medium">{reservation.user.name}</p>
            <p className="text-sm text-muted-foreground">{reservation.user.email}</p>
            {reservation.user.phone && (
              <p className="text-sm text-muted-foreground">{reservation.user.phone}</p>
            )}
            <Badge variant="outline" className="mt-2 text-xs">
              {reservation.user.customerType === "STORE" ? "Mayoreo" : "Menudeo"}
            </Badge>
          </div>

          {/* Detalles de la reserva */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Tipo:</span>
              <p className="font-medium">
                {reservation.type === "DEPOSIT" ? "Con Depósito" : "Temporal"}
              </p>
            </div>
            {reservation.depositAmount && (
              <div>
                <span className="text-muted-foreground">Depósito:</span>
                <p className="font-medium"><PriceDisplay price={reservation.depositAmount ?? 0} /></p>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Creada:</span>
              <p className="font-medium">
                {new Date(reservation.createdAt).toLocaleString("es-MX", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">
                {isExpired ? "Expiró:" : "Expira:"}
              </span>
              <p className={`font-medium ${isExpired ? "text-destructive" : ""}`}>
                {new Date(reservation.expiresAt).toLocaleString("es-MX", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>

          {/* Acciones */}
          <VerifyActions
            qrCode={qrCode}
            paymentMethod={reservation.paymentMethod}
            due={Math.max(0, reservation.totalPrice - (reservation.depositPaid ? reservation.depositAmount ?? reservation.totalPrice : 0))}
            canComplete={canComplete}
            status={reservation.status}
            isExpired={isExpired}
          />
        </CardContent>
      </Card>
      </main>
    </div>
  )
}
