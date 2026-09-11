require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Pool } = require('pg')
const { PrismaPg } = require('@prisma/adapter-pg')

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
                const updated = await prisma.user.update({
                    where: { telegramId: '1070427489' },
                    data: { role: 'ADMIN' }
                })
                console.log('\n✅ Usuario actualizado a ADMIN!')
            } else {
                console.log('\n✅ Ya eres ADMIN!')
            }
        } else {
            // Vincular a admin
            const updated = await prisma.user.update({
                where: { email: 'admin@prosolutions.com' },
                data: { telegramId: '1070427489' }
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
