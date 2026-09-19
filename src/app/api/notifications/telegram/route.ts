import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getSession, requireModule } from '@/lib/api-auth'
import { businessIdOf } from '@/lib/tenant'

// API para enviar notificaciones vía Telegram Bot
// POST /api/notifications/telegram
export async function POST(req: NextRequest) {
    const result = await requireModule("notificaciones")
    if (result.error) return result.error
    const businessId = businessIdOf(getSession(result)!)

    try {
        const { message, customerType } = await req.json()

        if (!message) {
            return NextResponse.json({ error: 'Mensaje requerido' }, { status: 400 })
        }

        // Enviar a todos los usuarios con telegramId
        const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
        if (!BOT_TOKEN) {
            return NextResponse.json({ error: 'Bot no configurado' }, { status: 500 })
        }

        const { prisma } = await import('@/lib/prisma')

        const where: Prisma.UserWhereInput = { businessId, telegramId: { not: null } }
        if (customerType && customerType !== 'ALL') {
            where.customerType = customerType
        }

        const users = await prisma.user.findMany({
            where,
            select: { telegramId: true, name: true }
        })

        let sent = 0
        let failed = 0

        for (const user of users) {
            if (!user.telegramId) continue

            try {
                const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: user.telegramId,
                        text: message,
                        parse_mode: 'Markdown'
                    })
                })

                if (res.ok) sent++
                else failed++
            } catch {
                failed++
            }
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
