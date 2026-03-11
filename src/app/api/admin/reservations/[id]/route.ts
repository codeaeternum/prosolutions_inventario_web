import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireAdmin } from '@/lib/api-auth'

const sendTelegramMessage = async (chatId: string, text: string) => {
    const token = process.env.TELEGRAM_BOT_TOKEN
    if (!token) return
    try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
        })
    } catch (e) {
        console.error('Error sending TG msg:', e)
    }
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const result = await requireAdmin()
    if (result.error) return result.error

    const { id } = await params
    const { action, finalPaymentMethod } = await request.json()

    // Obtener reserva actual con detalles
    const reservation = await prisma.reservation.findUnique({
        where: { id },
        include: { user: true, product: true }
    })

    if (!reservation) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    let data: any = {}
    let notificationMsg = ''
    let isCreditUpdate = false;

    if (action === 'pay') {
        data = { status: 'PAID' }
        notificationMsg = `✅ *Pago Validado*\n\nTu reserva de *${reservation.product.name}* ha sido confirmada. ¡Gracias!`
    } else if (action === 'deliver') {
        data = { status: 'COMPLETED' }
        
        if (finalPaymentMethod && finalPaymentMethod !== reservation.paymentMethod) {
            data.paymentMethod = finalPaymentMethod;
            
            if (finalPaymentMethod === 'CREDIT' && reservation.paymentMethod !== 'CREDIT') {
                const user = reservation.user;
                const limit = user.creditLimit ?? 0;
                const balance = user.creditBalance ?? 0;
                
                if (limit <= 0 || (balance + reservation.totalPrice) > limit) {
                    return NextResponse.json({ error: 'Límite de crédito insuficiente.' }, { status: 400 })
                }
                isCreditUpdate = true;
            }
        }
        
        notificationMsg = `📦 *¡Pedido Entregado!*\n\nHas recibido tu producto: *${reservation.product.name}*.\n\n¡Gracias por tu compra!`
    } else if (action === 'cancel') {
        // Solo cancelar si no está cancelada/completada
        if (['CANCELLED', 'COMPLETED'].includes(reservation.status)) {
            return NextResponse.json({ error: 'Cannot cancel' }, { status: 400 })
        }

        data = { status: 'CANCELLED' }
        notificationMsg = `❌ *Reserva Cancelada*\n\nTu reserva de *${reservation.product.name}* ha sido cancelada por el administrador.`

        // Devolver stock
        await prisma.product.update({
            where: { id: reservation.productId },
            data: { stock: { increment: reservation.quantity } }
        })
    }

    let updated;
    
    if (isCreditUpdate) {
        // Ejecutar todo en transacción si hay que afectar el crédito
        const [_, __, res] = await prisma.$transaction([
            prisma.creditMovement.create({
                data: {
                    userId: reservation.userId,
                    amount: reservation.totalPrice,
                    type: 'DEBT',
                    referenceType: 'RESERVATION',
                    referenceId: reservation.id,
                    notes: `Cobro en entrega de Reserva #${reservation.id.slice(-8)} - ${reservation.product.name} x${reservation.quantity}`,
                }
            }),
            prisma.user.update({
                where: { id: reservation.userId },
                data: { creditBalance: { increment: reservation.totalPrice } }
            }),
            prisma.reservation.update({
                where: { id },
                data
            })
        ]);
        updated = res;
    } else {
        updated = await prisma.reservation.update({
            where: { id },
            data
        });

        // Registrar entrada en caja si fue en efectivo y es entrega
        if (action === 'deliver' && (finalPaymentMethod === 'EFECTIVO' || finalPaymentMethod === 'TARJETA' || finalPaymentMethod === 'TRANSFERENCIA')) {
            const openRegister = await prisma.cashRegister.findFirst({
                where: { status: "OPEN" }
            });
            
            if (openRegister) {
                const sessionAuth = await requireAdmin(); // para sacar el ID del usuario
                let adminId = reservation.userId;
                
                // Extraer el ID correctamente sorteando los tipos de NextAuth
                const s = sessionAuth.session as any;
                if (!sessionAuth.error && s?.user?.id) {
                    adminId = s.user.id;
                }

                await prisma.cashMovement.create({
                    data: {
                        registerId: openRegister.id,
                        amount: reservation.totalPrice,
                        type: "IN",
                        description: `Pago de Reserva: ${reservation.product.name} (${finalPaymentMethod})`,
                        referenceType: "RESERVATION",
                        referenceId: reservation.id,
                        userId: adminId,
                    }
                });
            }
        }
    }

    // Enviar notificación si hay mensaje y usuario tiene telegramId
    if (notificationMsg && reservation.user.telegramId) {
        await sendTelegramMessage(reservation.user.telegramId, notificationMsg)
    }

    return NextResponse.json(updated)
}
