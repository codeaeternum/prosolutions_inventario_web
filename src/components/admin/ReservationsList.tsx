'use client'
import { useState } from 'react'
import Image from 'next/image'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
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
import { Badge } from '@/components/ui/badge'
import { useCurrency } from '@/components/currency-provider'
import { User, QrCode as QrCodeIcon, Phone, Send } from 'lucide-react'

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning'

const statusConfig: Record<string, { label: string; variant: BadgeVariant }> = {
    PENDING: { label: 'Pendiente', variant: 'outline' },
    PENDING_PAYMENT: { label: 'Esperando pago', variant: 'warning' },
    PAID: { label: 'Pagado', variant: 'default' },
    DEPOSIT_VERIFIED: { label: 'Verificado', variant: 'default' },
    APPROVED: { label: 'Lista', variant: 'default' },
    REJECTED: { label: 'Rechazada', variant: 'destructive' },
    COMPLETED: { label: 'Entregado', variant: 'success' },
    CANCELLED: { label: 'Cancelado', variant: 'destructive' },
    EXPIRED: { label: 'Expirada', variant: 'destructive' },
    SHIPPED: { label: 'Enviado', variant: 'secondary' },
}

export default function ReservationsList({ reservations }: { reservations: any[] }) {
    const router = useRouter()
    const { formatPrice } = useCurrency()

    const [selectedProof, setSelectedProof] = useState<string | null>(null)
    const [selectedQR, setSelectedQR] = useState<string | null>(null)
    const [isUpdating, setIsUpdating] = useState(false)
    const [actionDialog, setActionDialog] = useState<{ id: string, action: 'pay' | 'deliver' | 'cancel' } | null>(null)
    const [finalPaymentMethod, setFinalPaymentMethod] = useState<string>('EFECTIVO')

    const selectedRes = actionDialog ? reservations.find(r => r.id === actionDialog.id) : null;

    const handleAction = async (id: string, action: 'pay' | 'deliver' | 'cancel') => {
        setIsUpdating(true)
        try {
            const payload: any = { action }
            if (action === 'deliver' && selectedRes && selectedRes.paymentMethod !== 'CREDIT' && selectedRes.status !== 'PAID') {
                payload.finalPaymentMethod = finalPaymentMethod;
            }

            const res = await fetch(`/api/admin/reservations/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            if (res.ok) {
                router.refresh()
                if (action === 'deliver') {
                    // Abrir ticket en nueva pestaña
                    window.open(`/admin/tickets/reserva/${id}`, '_blank')
                }
            } else {
                const errData = await res.json().catch(() => null)
                toast.error('Error al actualizar: ' + (errData?.error || 'Respuesta no válida'))
            }
        } catch (e) {
            toast.error('Error de conexión. Revisa tu red e intenta de nuevo.')
        } finally {
            setIsUpdating(false)
            setActionDialog(null)
            setFinalPaymentMethod('EFECTIVO')
        }
    }

    return (
        <div className="bg-card rounded-xl shadow-lg overflow-hidden border border-border">
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="bg-muted text-left text-sm font-semibold text-muted-foreground">
                            <th className="p-4">Fecha</th>
                            <th className="p-4">Cliente</th>
                            <th className="p-4">Producto</th>
                            <th className="p-4">Total</th>
                            <th className="p-4">Estado</th>
                            <th className="p-4">Comprobante</th>
                            <th className="p-4">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {reservations.map((r) => (
                            <tr key={r.id} className="hover:bg-muted/50 text-sm">
                                <td className="p-4 text-xs text-muted-foreground whitespace-nowrap" title={r.id}>
                                    {new Date(r.createdAt).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}
                                    <span className="block">{new Date(r.createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>
                                </td>
                                <td className="p-4">
                                    <div className="font-medium text-foreground flex items-center gap-2">
                                        {r.user.name}
                                        <button
                                            onClick={async () => {
                                                try {
                                                    const url = await QRCode.toDataURL(r.user.qrCode || r.user.telegramId || 'N/A')
                                                    setSelectedQR(url)
                                                } catch (e) {
                                                    toast.error('Error generando QR Cliente')
                                                }
                                            }}
                                            className="text-muted-foreground hover:text-foreground"
                                            title="Ver QR Cliente"
                                        >
                                            <User className="h-4 w-4" />
                                        </button>
                                        <button
                                            onClick={async () => {
                                                try {
                                                    const qrData = `${window.location.origin}/verificar/${r.qrCode || r.id}`
                                                    const url = await QRCode.toDataURL(qrData)
                                                    setSelectedQR(url)
                                                } catch (e) {
                                                    toast.error('Error generando QR Reserva')
                                                }
                                            }}
                                            className="text-muted-foreground hover:text-foreground"
                                            title="Ver QR Reserva"
                                        >
                                            <QrCodeIcon className="h-4 w-4" />
                                        </button>
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-2">
                                        {r.user.phone && (
                                            <a href={`https://wa.me/${r.user.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1" title="Contactar por WhatsApp">
                                                <Phone className="h-3.5 w-3.5" /> {r.user.phone}
                                            </a>
                                        )}
                                        {!r.user.phone && <span className="text-muted-foreground">Sin teléfono</span>}

                                        {r.user.telegramId && (
                                            <span className="text-blue-500 ml-1 inline-flex" title="Usuario Telegram"><Send className="h-3.5 w-3.5" /></span>
                                        )}
                                    </div>
                                </td>
                                <td className="p-4">
                                    <div className="text-foreground">{r.product?.name ?? "—"}</div>
                                    <div className="text-xs text-muted-foreground">{r.quantity} uds</div>
                                </td>
                                <td className="p-4 font-medium text-primary">
                                    {formatPrice(r.totalPrice)}
                                </td>
                                <td className="p-4">
                                    <Badge variant={statusConfig[r.status]?.variant ?? 'secondary'} className="text-xs">
                                        {statusConfig[r.status]?.label ?? r.status}
                                    </Badge>
                                </td>
                                <td className="p-4">
                                    {r.paymentProofUrl ? (
                                        <button
                                            onClick={() => setSelectedProof(r.paymentProofUrl)}
                                            className="text-primary hover:underline flex items-center gap-1"
                                        >
                                            📸 Ver Foto
                                        </button>
                                    ) : (
                                        <span className="text-muted-foreground">-</span>
                                    )}
                                </td>
                                <td className="p-4 flex flex-wrap gap-2">
                                    {/* PENDING_PAYMENT (Esperando validación) */}
                                    {r.status === 'PENDING_PAYMENT' && (
                                        <button
                                            onClick={() => setActionDialog({ id: r.id, action: 'pay' })}
                                            disabled={isUpdating}
                                            className="p-1 px-3 bg-primary text-primary-foreground rounded hover:opacity-90 text-xs disabled:opacity-50"
                                        >
                                            Validar pago
                                        </button>
                                    )}

                                    {/* PENDING (Reserva normal) o PAID */}
                                    {(r.status === 'PENDING' || r.status === 'PAID') && (
                                        <button
                                            onClick={() => setActionDialog({ id: r.id, action: 'deliver' })}
                                            disabled={isUpdating}
                                            className="p-1 px-3 bg-primary text-primary-foreground rounded hover:opacity-90 text-xs disabled:opacity-50"
                                        >
                                            Entregar
                                        </button>
                                    )}

                                    {/* Cancelar (si no está ya cancelado/completado) */}
                                    {r.status !== 'CANCELLED' && r.status !== 'COMPLETED' && (
                                        <button
                                            onClick={() => setActionDialog({ id: r.id, action: 'cancel' })}
                                            disabled={isUpdating}
                                            className="p-1 px-3 bg-destructive/10 text-destructive rounded hover:bg-destructive/20 text-xs disabled:opacity-50"
                                            title="Eliminar/Cancelar"
                                        >
                                            🗑️
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Modal Foto */}
            {selectedProof && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={() => setSelectedProof(null)}>
                    <div className="relative max-w-3xl max-h-[90vh] w-full bg-card rounded-lg p-2 border border-border">
                        <button className="absolute -top-10 right-0 text-white text-xl" onClick={() => setSelectedProof(null)}>✕ Cerrar</button>
                        <div className="relative w-full h-[80vh]">
                            {/* Usamos img normal porque Next/Image requiere domain config */}
                            <img
                                src={selectedProof}
                                alt="Comprobante"
                                className="w-full h-full object-contain"
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* Modal QR */}
            {selectedQR && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={() => setSelectedQR(null)}>
                    <div className="relative bg-card rounded-lg p-6 max-w-sm w-full text-center border border-border">
                        <button className="absolute top-2 right-2 text-muted-foreground hover:text-foreground" onClick={() => setSelectedQR(null)}>✕</button>
                        <h3 className="text-lg font-bold mb-4">Código QR</h3>
                        <div className="bg-muted p-2 inline-block rounded border border-border">
                            <img src={selectedQR} alt="QR Cliente/Reserva" className="w-64 h-64" />
                        </div>
                    </div>
                </div>
            )}

            <AlertDialog open={!!actionDialog} onOpenChange={(open) => !open && setActionDialog(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {actionDialog?.action === 'pay' ? '¿Validar pago?' :
                             actionDialog?.action === 'deliver' ? '¿Marcar como entregado?' :
                             '¿Cancelar reserva?'}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {actionDialog?.action === 'pay' ? 'Se confirmará que has recibido el pago por esta reserva.' :
                             actionDialog?.action === 'deliver' ? 'Se registrará que el producto ha sido entregado al cliente.' :
                             'Esta acción cancelará la reserva y devolverá el stock al inventario.'}
                        </AlertDialogDescription>

                        {actionDialog?.action === 'deliver' && selectedRes && selectedRes.paymentMethod !== 'CREDIT' && selectedRes.status !== 'PAID' && (
                            <div className="mt-4 space-y-2">
                                <label className="text-sm font-medium text-foreground">Método de pago al entregar</label>
                                <select 
                                    className="w-full p-2 border border-border rounded bg-background text-foreground"
                                    value={finalPaymentMethod}
                                    onChange={(e) => setFinalPaymentMethod(e.target.value)}
                                >
                                    <option value="EFECTIVO">Efectivo</option>
                                    <option value="TRANSFERENCIA">Transferencia</option>
                                    <option value="TARJETA">Tarjeta</option>
                                    <option value="CREDIT">A Crédito (Descontar de saldo)</option>
                                </select>
                            </div>
                        )}
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isUpdating}>Volver</AlertDialogCancel>
                        <AlertDialogAction 
                            onClick={(e) => { 
                                e.preventDefault(); 
                                if (actionDialog) handleAction(actionDialog.id, actionDialog.action); 
                            }} 
                            disabled={isUpdating}
                            className={actionDialog?.action === 'cancel' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
                        >
                            {isUpdating ? 'Procesando...' : 'Confirmar'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
