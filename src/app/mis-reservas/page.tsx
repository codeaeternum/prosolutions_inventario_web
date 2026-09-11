"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { toast } from "sonner"
import {
  CalendarCheck,
  Clock,
  Package,
  Timer,
  CreditCard,
  XCircle,
  Loader2,
  Home,
  ShoppingCart,
  User,
  LogOut,
  QrCode,
} from "lucide-react"
import { useCurrency } from "@/components/currency-provider"
import { signOut, useSession } from "next-auth/react"
import { CountdownTimer } from "@/components/countdown-timer"
import { ReservationQR } from "@/components/reservation-qr"
import { Pagination } from "@/components/ui/pagination"
import type { Reservation, ReservationStatus } from "@/types"

const statusLabels: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success"; description: string }> = {
  PENDING: {
    label: "Pendiente",
    variant: "outline",
    description: "Tu reserva está pendiente de entrega o revisión"
  },
  PENDING_PAYMENT: {
    label: "Pendiente de pago",
    variant: "outline",
    description: "Tu reserva está esperando el comprobante de pago"
  },
  DEPOSIT_VERIFIED: {
    label: "Verificado",
    variant: "default",
    description: "Tu depósito fue verificado, pasa a recoger"
  },
  APPROVED: {
    label: "Lista",
    variant: "default",
    description: "Tu reserva está lista, pasa a recogerla"
  },
  REJECTED: {
    label: "Rechazada",
    variant: "destructive",
    description: "Tu reserva fue rechazada"
  },
  COMPLETED: {
    label: "Entregada",
    variant: "success",
    description: "Producto entregado exitosamente"
  },
  CANCELLED: {
    label: "Cancelada",
    variant: "destructive",
    description: "Esta reserva fue cancelada"
  },
  EXPIRED: {
    label: "Expirada",
    variant: "destructive",
    description: "La reserva expiró"
  },
} satisfies Record<ReservationStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success"; description: string }>

export default function MisReservasPage() {
  const { formatPrice } = useCurrency()
  const sessionData = useSession()
  const session = sessionData?.data
  const status = sessionData?.status
  const router = useRouter()
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [view, setView] = useState<"active" | "history">("active")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const pageSize = 20
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [showQRDialog, setShowQRDialog] = useState(false)
  const [selectedQR, setSelectedQR] = useState<{ qrCode: string; id: string } | null>(null)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [reservationToCancel, setReservationToCancel] = useState<string | null>(null)

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login")
    }
  }, [status, router])

  useEffect(() => {
    if (!session?.user?.id) return
    const controller = new AbortController()
    const fetchReservations = async () => {
      setIsLoading(true)
      setLoadError(null)
      try {
        const params = new URLSearchParams({ view, page: String(page), limit: String(pageSize) })
        const res = await fetch(`/api/reservations?${params}`, { signal: controller.signal })
        if (!res.ok) throw new Error("No se pudieron cargar tus reservas")
        const data = await res.json()
        if (!Array.isArray(data.reservations)) throw new Error("Respuesta de reservas no válida")
        if (controller.signal.aborted) return
        const lastPage = Math.max(1, Number(data.totalPages) || 1)
        setReservations(data.reservations)
        setTotal(Number(data.total) || 0)
        setTotalPages(lastPage)
        if (page > lastPage) setPage(lastPage)
      } catch {
        if (!controller.signal.aborted) setLoadError("No se pudieron cargar tus reservas. Revisa tu conexión y vuelve a intentar.")
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }
    void fetchReservations()
    return () => controller.abort()
  }, [session?.user?.id, view, page, reload])

  const handleCancelClick = (id: string) => {
    setReservationToCancel(id)
    setCancelDialogOpen(true)
  }

  const handleConfirmCancel = async () => {
    if (!reservationToCancel) return
    setCancellingId(reservationToCancel)
    setCancelDialogOpen(false)
    try {
      const res = await fetch(`/api/reservations/${reservationToCancel}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      })

      if (res.ok) {
        setReload((value) => value + 1)
        toast.success("Reserva cancelada exitosamente")
      } else {
        const data = await res.json().catch(() => null)
        toast.error(data?.error || "No se pudo cancelar la reserva. Vuelve a intentar.")
      }
    } catch (error) {
      console.error("Error cancelling reservation:", error)
      toast.error("Error al cancelar la reserva")
    } finally {
      setCancellingId(null)
      setReservationToCancel(null)
    }
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const activeReservations = reservations.filter(r =>
    ["PENDING", "PENDING_PAYMENT", "DEPOSIT_VERIFIED", "APPROVED"].includes(r.status)
  )
  const pastReservations = reservations.filter(r =>
    ["COMPLETED", "CANCELLED", "EXPIRED", "REJECTED"].includes(r.status)
  )

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 safe-area-sticky z-50 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto max-w-7xl flex h-14 items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/logo.jpg"
              alt="Pro-Solutions"
              width={36}
              height={36}
              className="rounded-lg"
            />
            <span className="font-bold text-lg hidden sm:inline">Pro-Solutions</span>
          </Link>

          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button variant="ghost" size="sm" asChild>
              <Link href="/">
                <Home className="h-4 w-4" />
              </Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/perfil">
                <User className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => signOut({ callbackUrl: "/" })}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main id="main-content" className="container mx-auto max-w-2xl px-4 py-6" role="main">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex gap-2" aria-label="Filtrar reservas">
            <Button variant={view === "active" ? "default" : "outline"} aria-pressed={view === "active"} onClick={() => { setView("active"); setPage(1) }}>Activas</Button>
            <Button variant={view === "history" ? "default" : "outline"} aria-pressed={view === "history"} onClick={() => { setView("history"); setPage(1) }}>Historial</Button>
          </div>
          <Button variant="ghost" size="sm" disabled={isLoading} onClick={() => setReload((value) => value + 1)}>Actualizar</Button>
        </div>
        <div className="mb-6">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <CalendarCheck className="h-5 w-5" />
            Mis Reservas
          </h1>
        </div>

        {loadError ? (
          <div role="alert" className="rounded-lg border p-6 space-y-3">
            <p>{loadError}</p>
            <Button variant="outline" onClick={() => setReload((value) => value + 1)}>Reintentar</Button>
          </div>
        ) : isLoading ? (
          <div role="status" className="py-12 text-center"><Loader2 className="h-7 w-7 animate-spin mx-auto mb-3" />Cargando reservas...</div>
        ) : reservations.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <CalendarCheck className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-medium mb-2">{view === "active" ? "No tienes reservas activas" : "Todavía no tienes reservas en el historial"}</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Las reservas que hagas desde el catálogo o el carrito aparecerán aquí. Puedes ver el estado, el QR y cancelar si lo necesitas.
              </p>
              <Button asChild size="sm">
                <Link href="/catalogo">
                  <ShoppingCart className="h-4 w-4 mr-2" />
                  Ir al catálogo
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Active Reservations */}
            {activeReservations.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2 text-primary">
                  <Clock className="h-4 w-4" />
                  Activas ({total})
                </h2>
                <div className="space-y-3">
                  {activeReservations.map((reservation) => (
                    <Card key={reservation.id} className="overflow-hidden">
                      <CardContent className="p-3">
                        <div className="flex gap-3">
                          {/* QR Code */}
                          {reservation.qrCode && (
                            <button
                              onClick={() => {
                                setSelectedQR({ qrCode: reservation.qrCode!, id: reservation.id })
                                setShowQRDialog(true)
                              }}
                              className="flex-shrink-0 hover:opacity-80 transition-opacity"
                            >
                              <ReservationQR
                                qrCode={reservation.qrCode}
                                reservationId={reservation.id}
                                size={70}
                                showCode={false}
                              />
                            </button>
                          )}

                          {/* Product Image (only if no QR) */}
                          {!reservation.qrCode && (
                            <div className="h-16 w-16 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 relative overflow-hidden">
                              {reservation.product?.images?.[0] ? (
                                <Image
                                  src={reservation.product.images[0]}
                                  alt={reservation.product?.name ?? "Producto"}
                                  fill
                                  sizes="64px"
                                  className="object-cover rounded-lg"
                                />
                              ) : (
                                <Package className="h-6 w-6 text-muted-foreground" />
                              )}
                            </div>
                          )}

                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="font-medium text-sm truncate" title={reservation.product?.name}>
                                {reservation.product?.name ?? "Producto"}
                              </h3>
                              <Badge variant={statusLabels[reservation.status]?.variant || "outline"} className="text-[10px] px-1.5 flex-shrink-0">
                                {statusLabels[reservation.status]?.label || reservation.status}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {statusLabels[reservation.status]?.description ?? "—"}
                            </p>
                            <div className="flex flex-wrap items-center gap-2 mt-2">
                              <Badge variant="outline" className="text-[10px] px-1.5">
                                {reservation.type === "TEMPORARY" ? (
                                  <>
                                    <Timer className="h-2.5 w-2.5 mr-0.5" />
                                    Temp
                                  </>
                                ) : (
                                  <>
                                    <CreditCard className="h-2.5 w-2.5 mr-0.5" />
                                    Dep
                                  </>
                                )}
                              </Badge>
                              <span className="text-xs">
                                x{reservation.quantity}
                              </span>
                              <span className="text-xs font-bold text-primary">
                                {formatPrice(reservation.totalPrice)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between mt-2">
                              <CountdownTimer expiresAt={reservation.expiresAt} compact />
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-destructive hover:text-destructive"
                                onClick={() => handleCancelClick(reservation.id)}
                                disabled={cancellingId === reservation.id}
                              >
                                {cancellingId === reservation.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <>
                                    <XCircle className="h-3 w-3 mr-1" />
                                    Cancelar
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {/* Past Reservations */}
            {pastReservations.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold mb-3 text-muted-foreground">
                  Historial ({total})
                </h2>
                <div className="space-y-2">
                  {pastReservations.map((reservation) => (
                    <Card key={reservation.id} className="overflow-hidden opacity-60">
                      <CardContent className="p-3">
                        <div className="flex gap-3 items-center">
                          <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 relative overflow-hidden">
                            {reservation.product?.images?.[0] ? (
                                <Image
                                  src={reservation.product.images[0]}
                                  alt={reservation.product?.name ?? "Producto"}
                                  fill
                                  sizes="48px"
                                  className="object-cover rounded-lg"
                                />
                              ) : (
                                <Package className="h-5 w-5 text-muted-foreground" />
                              )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <h3 className="font-medium text-sm truncate" title={reservation.product?.name}>{reservation.product?.name ?? "Producto"}</h3>
                              <Badge variant={statusLabels[reservation.status]?.variant || "outline"} className="text-[10px] px-1.5">
                                {statusLabels[reservation.status]?.label || reservation.status}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                              <span>x{reservation.quantity}</span>
                              <span>{formatPrice(reservation.totalPrice)}</span>
                              <span>{new Date(reservation.createdAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}</span>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
        {!loadError && !isLoading && total > 0 && (
          <div className="mt-6 border-t pt-4">
            <Pagination page={page} limit={pageSize} total={total} totalPages={totalPages} onPageChange={setPage} />
          </div>
        )}
      </main>

      {/* QR Dialog */}
      <Dialog open={showQRDialog} onOpenChange={setShowQRDialog}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 justify-center">
              <QrCode className="h-5 w-5" />
              Tu Código QR
            </DialogTitle>
          </DialogHeader>
          {selectedQR && (
            <div className="flex flex-col items-center py-4">
              <ReservationQR
                qrCode={selectedQR.qrCode}
                reservationId={selectedQR.id}
                size={220}
              />
              <p className="text-sm text-muted-foreground mt-4 text-center">
                Muestra este código al recoger tu reserva
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar reserva?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El producto volverá a estar disponible para otros clientes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, mantener</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmCancel}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Sí, cancelar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
