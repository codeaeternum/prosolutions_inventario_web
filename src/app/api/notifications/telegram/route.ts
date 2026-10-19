import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { getSession, requireModule } from '@/lib/api-auth'
import { businessIdOf } from '@/lib/tenant'

// Límite Telegram ≈ 4096 chars; 2000 deja margen y evita muros de texto.
const MAX_MESSAGE_CHARS = 2000
const FETCH_TIMEOUT_MS = 8000
// Concurrencia acotada: los envíos salen en tandas para no abrir un socket
// por usuario ni bloquear el request en serie.
const SEND_CHUNK = 10

const bodySchema = z.object({
    message: z.string().trim().min(1, 'Mensaje requerido').max(MAX_MESSAGE_CHARS),
    // "staff" (default): solo ADMIN/EMPLOYEE/WORKSHOP del negocio. "all" incluye
    // CUSTOMER — hay que pedirla explícitamente para no bombardear clientes por
    // accidente; combinable con customerType para segmentar.
    audience: z.enum(['staff', 'all']).default('staff'),
    customerType: z.enum(['TECHNICIAN', 'STORE', 'NORMAL', 'ALL']).optional(),
})

// API para enviar notificaciones vía Telegram Bot
// POST /api/notifications/telegram
export async function POST(req: NextRequest) {
    const result = await requireModule("notificaciones")
    if (result.error) return result.error
    const businessId = businessIdOf(getSession(result)!)

    try {
        const parsed = bodySchema.safeParse(await req.json().catch(() => null))
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Mensaje requerido' }, { status: 400 })
        }
        const { message, audience, customerType } = parsed.data

        // Enviar a todos los usuarios con telegramId
        const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
        if (!BOT_TOKEN) {
            return NextResponse.json({ error: 'Bot no configurado' }, { status: 500 })
        }

        const { prisma } = await import('@/lib/prisma')

        const where: Prisma.UserWhereInput = { businessId, telegramId: { not: null }, status: 'APPROVED' }
        if (audience === 'staff') {
            where.role = { in: ['ADMIN', 'EMPLOYEE', 'WORKSHOP'] }
        } else if (customerType && customerType !== 'ALL') {
            where.customerType = customerType
        }

        const users = await prisma.user.findMany({
            where,
            select: { telegramId: true, name: true }
        })

        let sent = 0
        let failed = 0

        for (let i = 0; i < users.length; i += SEND_CHUNK) {
            await Promise.all(users.slice(i, i + SEND_CHUNK).map(async user => {
                if (!user.telegramId) return
                try {
                    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: user.telegramId,
                            text: message,
                            parse_mode: 'Markdown'
                        }),
                        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
                    })
                    if (res.ok) sent++
                    else failed++
                } catch {
                    failed++
                }
            }))
        }

        return NextResponse.json({
            success: true,
            sent,
            failed,
            total: users.length
        })

    } catch (error) {
        console.error('Error sending notifications:', error)
        return NextResponse.json({ error: 'Error interno' }, { status: 500 })
    }
}
