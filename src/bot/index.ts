import { expireReservations } from "../lib/domain/reservations"
import { purgePendingSignups } from "../lib/pending-signup-purge"
import 'dotenv/config'
import { Telegraf } from 'telegraf'
import * as cron from 'node-cron'
import { getPrisma } from './lib/prisma'
import { notifyAdmins } from './lib/notify'
import { loggerMiddleware } from './middlewares/logger'
import { registerStart } from './commands/start'
import { registerHelp } from './commands/help'
import { registerMiid } from './commands/miid'
import { registerCancelar } from './commands/cancelar'
import { registerSettings } from './commands/settings'
import { registerUsers } from './commands/users'
import { registerSales } from './commands/sales'
import { registerCart } from './commands/cart'
import { registerReports } from './commands/reports'
import { registerCatalog } from './commands/catalog'
import { registerProducts } from './commands/products'
import { registerAlerts } from './commands/alerts'
import { registerOrden } from './commands/orden'
import type { SessionStores, BotContext } from './lib/types'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const isDev = process.env.NODE_ENV !== 'production'

if (!BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN required')
    process.exit(1)
}

const bot = new Telegraf(BOT_TOKEN)
const _prisma = getPrisma()
const prisma = _prisma!

console.log('🤖 ProSolutions Bot Starting...')

// Account data and every bot command are restricted to direct private conversations.
bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== 'private' || !ctx.from) return
    const user = await prisma.user.findUnique({ where: { telegramId: ctx.from.id.toString() }, select: { status: true } })
    if (user?.status === 'REJECTED') { await ctx.reply('Tu cuenta no está habilitada. Contacta al administrador.'); return }
    return next()
})

// Test notification command
bot.command('testnt', async (ctx) => {
    const telegramId = ctx.from.id.toString()
    const user = await prisma.user.findUnique({ where: { telegramId } })
    if (!user || user.role !== 'ADMIN' || user.status !== 'APPROVED') return
    await ctx.reply('🔔 Enviando notificación de prueba a todos los admins...')
    await notifyAdmins(bot, user.businessId, `🧪 <b>Prueba de Notificación</b>\n\nSi ves esto, el sistema funciona para ti.\nID: ${ctx.from.id}`)
    await ctx.reply('✅ Proceso terminado. Revisa si llegaron los mensajes.')
})

// Middleware
bot.use(loggerMiddleware)

// Session stores
const sessions: SessionStores = {
    registration: {},
    adminProduct: {},
    reservation: {},
    deleteProduct: {},
    sale: {},
    cart: {},
    qr: {},
    settings: {},
    orden: {},
}

// Shared context for all modules
const ctx: BotContext = { bot, prisma, sessions, isDev, BOT_TOKEN }

// ======= REGISTER ALL MODULES =======
// ORDER MATTERS: settings text handler must be before the main text handler

registerStart(bot, prisma, sessions.registration)
registerHelp(bot)
registerMiid(bot)
registerCancelar(bot, {
    registration: sessions.registration,
    adminProduct: sessions.adminProduct,
    reservation: sessions.reservation,
    deleteProduct: sessions.deleteProduct,
    sale: sessions.sale,
    cart: sessions.cart,
    qr: sessions.qr,
    settings: sessions.settings,
    orden: sessions.orden,
})

registerSettings(ctx)
registerUsers(ctx)
// /orden: su handler de texto debe registrarse ANTES de los hears de sales.ts
// (el de "SI" no cede con next()) y del handler de texto principal de
// products.ts, que es terminal — un listener registrado después jamás vería
// las respuestas del wizard.
registerOrden(ctx)
registerSales(ctx)
registerCart(ctx)
registerReports(ctx)
const { processReservation } = registerCatalog(ctx)
registerProducts(ctx, processReservation)
registerAlerts(ctx)

// ======= CRON JOBS =======

// Cancel expired reservations every 30 min
cron.schedule('*/30 * * * *', async () => {
    if (isDev) console.log('⏳ Checking for expired reservations...')

    try {
        const result = await expireReservations(prisma)
        if (isDev) console.log('Reservation expiration', result)
    } catch (e) {
        console.error('Error in expiration job:', e)
    }
})

// Purga diaria (04:17) de altas de negocio cuyo owner sigue PENDING — nunca
// verificaron su contacto. El endpoint /api/cron/purge-pending-signups usa
// la misma lógica para forzarla a mano o desde schedulers externos.
cron.schedule('17 4 * * *', async () => {
    try {
        const result = await purgePendingSignups(prisma)
        if (result.purged > 0 || result.skipped.length > 0) {
            console.log('Pending signup purge:', result)
        }
    } catch (e) {
        console.error('Error in pending signup purge job:', e)
    }
})

// ======= LAUNCH =======

bot.launch(async () => {
    console.log('🚀 Bot is running!')

    try {
        await bot.telegram.setMyCommands([
            { command: 'start', description: '🏠 Iniciar' },
            { command: 'categorias', description: '📂 Por categoría' },
            { command: 'modelos', description: '📱 Por marca' },
            { command: 'ofertas', description: '🔥 Destacados' },
            { command: 'misreservas', description: '📋 Mis reservas pendientes' },
            { command: 'historial', description: '📜 Historial compras' },
            { command: 'orden', description: '🔧 Nueva orden de reparación' },
            { command: 'perfil', description: '👤 Mi perfil' },
            { command: 'cancelar', description: '❌ Cancelar' },
            { command: 'ayuda', description: '❓ Ayuda' }
        ])
        console.log('✅ Menú de comandos configurado')
    } catch (e) {
        console.error('Error configurando menú:', e)
    }
})

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
