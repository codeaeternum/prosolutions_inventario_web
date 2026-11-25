import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client.ts'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

async function linkTelegram() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL })
    const adapter = new PrismaPg(pool)
    const prisma = new PrismaClient({ adapter })

    try {
        // Primero, ver quién tiene este telegramId
        const existing = await prisma.user.findUnique({
            where: { telegramId: '1070427489' }
        })

        if (existing) {
            console.log('📌 Este Telegram ID ya está vinculado a:')
            console.log('  Usuario:', existing.name)
            console.log('  Email:', existing.email)
            console.log('  Rol:', existing.role)

            // Actualizar ese usuario a ADMIN
            if (existing.role !== 'ADMIN') {
                await prisma.user.update({
                    where: { telegramId: '1070427489' },
                    data: { role: 'ADMIN' }
                })
                console.log('\n✅ Usuario actualizado a ADMIN!')
            } else {
                console.log('\n✅ Ya eres ADMIN!')
            }
        } else {
            // Vincular a admin
            const adminEmail = 'admin@prosolutions.com'
            const admin = await prisma.user.findFirst({
                where: { email: { equals: adminEmail, mode: 'insensitive' } },
                select: { id: true }
            })
            if (!admin) throw new Error(`No existe la cuenta semilla ${adminEmail}`)
            await prisma.user.update({
                where: { id: admin.id },
                data: { telegramId: '1070427489', email: adminEmail }
            })
            console.log('✅ Telegram vinculado a admin!')
        }
    } catch (e) {
        console.error('Error:', e)
    } finally {
        await prisma.$disconnect()
        await pool.end()
    }
}

linkTelegram()
