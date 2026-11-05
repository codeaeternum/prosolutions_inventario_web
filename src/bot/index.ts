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
    if (!_prisma) return next()
    const user = await _prisma.user.findUnique({ where: { telegramId: ctx.from.id.toString() }, select: { status: true } })
    if (user?.status === 'REJECTED') { await ctx.reply('Tu cuenta no está habilitada. Contacta al administrador.'); return }
    return next()
})

// Test notification command (development only)
if (process.env.NODE_ENV === 'development') {
    bot.command('testnt', async (ctx) => {
        if (!_prisma) return
        const telegramId = ctx.from.id.toString()
        const user = await _prisma.user.findUnique({ where: { telegramId } })
        if (!user || user.role !== 'ADMIN' || user.status !== 'APPROVED') return
        await ctx.reply('🔔 Enviando notificación de prueba a todos los admins...')
        await notifyAdmins(bot, user.businessId, `🧪 <b>Prueba de Notificación</b>\n\nSi ves esto, el sistema funciona para ti.\nID: ${ctx.from.id}`)
        await ctx.reply('✅ Proceso terminado. Revisa si llegaron los mensajes.')
    })
}

// Middleware
bot.use(loggerMiddleware)

// Session stores with TTL (30m) and max-size bound per store to prevent leaks
const SESSION_TTL_MS = 30 * 60 * 1000
const MAX_SESSIONS_PER_STORE = 500
const sessionTimestamps = new Map<Record<string, unknown>, Map<string, number>>()

function createBoundedStore<T extends Record<string, unknown>>(): T {
    const target = {} as T
    const touched = new Map<string, number>()
    sessionTimestamps.set(target, touched)
    const proxy = new Proxy(target, {
        get(obj, prop, receiver) {
            if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(obj, prop)) {
                touched.set(prop, Date.now())
            }
            return Reflect.get(obj, prop, receiver)
        },
        set(obj, prop, value, receiver) {
            if (typeof prop === 'string') {
                touched.delete(prop)
                touched.set(prop, Date.now())
                while (touched.size > MAX_SESSIONS_PER_STORE) {
                    const oldest = touched.keys().next().value
                    if (oldest === undefined) break
                    touched.delete(oldest)
                    delete obj[oldest]
                }
            }
            return Reflect.set(obj, prop, value, receiver)
        },
        deleteProperty(obj, prop) {
            if (typeof prop === 'string') touched.delete(prop)
            return Reflect.deleteProperty(obj, prop)
        },
    })
    sessionTimestamps.set(proxy, touched)
    return proxy
}

function pruneStaleSessions(stores: SessionStores, now = Date.now()) {
    for (const store of Object.values(stores) as Record<string, unknown>[]) {
        const touched = sessionTimestamps.get(store)
        for (const key of Object.keys(store)) {
            const last = touched?.get(key)
            if (last === undefined || now - last > SESSION_TTL_MS) {
                delete store[key]
                touched?.delete(key)
            }
        }
    }
}

const sessions: SessionStores = {
    registration: createBoundedStore(),
    adminProduct: createBoundedStore(),
    reservation: createBoundedStore(),
    deleteProduct: createBoundedStore(),
    sale: createBoundedStore(),
    cart: createBoundedStore(),
    qr: createBoundedStore(),
    settings: createBoundedStore(),
    orden: createBoundedStore(),
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

// Cancel expired reservations and prune abandoned sessions every 30 min
cron.schedule('*/30 * * * *', async () => {
    pruneStaleSessions(sessions)
    if (!_prisma) return
    if (isDev) console.log('⏳ Checking for expired reservations...')

    try {
        const result = await expireReservations(_prisma)
        if (isDev) console.log('Reservation expiration', result)
    } catch (e) {
        console.error('Error in expiration job:', e)
    }
})

// Purga diaria (04:17) de altas de negocio cuyo owner sigue PENDING — nunca
// verificaron su contacto. El endpoint /api/cron/purge-pending-signups usa
// la misma lógica para forzarla a mano o desde schedulers externos.
cron.schedule('17 4 * * *', async () => {
    if (!_prisma) return
    try {
        const result = await purgePendingSignups(_prisma)
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
