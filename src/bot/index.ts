import { expireReservations } from "../lib/domain/reservations"
import { purgePendingSignups } from "../lib/pending-signup-purge"
import { purgeOldEvents } from "../lib/event-retention"
import { reconcileDelegations } from "../lib/domain/delegation-reconcile"
import 'dotenv/config'
import * as fs from 'node:fs'
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
import { registerDailySummary } from './commands/daily-summary'
import { registerLongShiftAlerts } from './commands/long-shift-alerts'
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

// Throttle por telegramId: máx 1 mensaje por segundo y 3 callback queries por
// segundo. Es el PRIMER middleware: el gate de cuenta de abajo hace un
// findUnique por update, así que un flood debe morir aquí, antes de pegarle a
// la BD. Cuenta todo tipo de mensaje (texto, foto, contacto…) — antes solo
// texto y un spam de fotos llegaba libre a los handlers. Map
// telegramId→timestamps recientes; las entradas sin actividad >60s se purgan
// en barridos ocasionales para que el Map no crezca sin límite.
const RATE_WINDOW_MS = 1_000
const RATE_SWEEP_MS = 60_000
const rateHits = new Map<string, number[]>()
let rateSweepAt = 0
bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return next()
    const id = ctx.from?.id?.toString()
    if (!id) return next()
    const isCallback = ctx.updateType === 'callback_query'
    const isMessage = ctx.updateType === 'message'
    if (!isCallback && !isMessage) return next()
    const now = Date.now()
    if (now >= rateSweepAt) {
        rateSweepAt = now + RATE_SWEEP_MS
        for (const [key, hits] of rateHits) {
            if (hits.length === 0 || hits[hits.length - 1] < now - RATE_SWEEP_MS) rateHits.delete(key)
        }
    }
    const window = (rateHits.get(id) ?? []).filter(t => now - t < RATE_WINDOW_MS)
    const limit = isCallback ? 3 : 1
    if (window.length >= limit) {
        // Aviso best-effort: el catch evita que un reply fallido en medio de
        // un flood escale a bot.catch / unhandled rejection.
        if (isCallback) await ctx.answerCbQuery('⏳ Un momento…').catch(() => {})
        else await ctx.reply('⏳ Un momento…').catch(() => {})
        return
    }
    window.push(now)
    rateHits.set(id, window)
    return next()
})

// Account data and every bot command are restricted to direct private conversations.
bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== 'private' || !ctx.from) return
    if (!_prisma) return next()
    try {
        const user = await _prisma.user.findUnique({
            where: { telegramId: ctx.from.id.toString() },
            select: { status: true, business: { select: { isActive: true } } },
        })
        if (user?.status === 'REJECTED') { await ctx.reply('Tu cuenta no está habilitada. Contacta al administrador.'); return }
        if (user?.business && !user.business.isActive) { await ctx.reply('Este negocio está suspendido.'); return }
    } catch (e) {
        // Fail-open: si Prisma (o el reply) falla, el update pasa y cada
        // comando aplica sus propios guards. Un throw aquí era unhandled
        // rejection y abortaba el proceso (Node ≥22).
        console.error('Error en gate de cuenta:', e)
    }
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
    // Solo el proxy se registra: pruneStaleSessions itera los stores (que son
    // proxies), nunca el target interno.
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
const alertsTask = registerAlerts(ctx)
const dailySummaryTask = registerDailySummary(ctx)
const longShiftTask = registerLongShiftAlerts(ctx)

// ======= CRON JOBS =======

// Handles de los crons: el shutdown ordenado los detiene para que un job a
// media ejecución (o sus timers) no mantenga el proceso vivo tras SIGTERM.
const scheduledTasks: cron.ScheduledTask[] = [alertsTask, dailySummaryTask, longShiftTask]

// Heartbeat cada minuto: el healthcheck del contenedor
// (`find <BOT_HEARTBEAT_FILE> -mmin -3 | grep .`) distingue "Up" real de un
// zombie (proceso vivo pero event loop/polling muertos, p. ej. con la BD
// caída). Se escribe la fecha actual; si el archivo envejece >3 min, Docker
// marca el contenedor unhealthy. En el shutdown ordenado se borra para que
// un bot detenido nunca pase por sano.
const HEARTBEAT_FILE = process.env.BOT_HEARTBEAT_FILE || '/tmp/bot-alive'
function touchHeartbeat() {
    try {
        fs.writeFileSync(HEARTBEAT_FILE, new Date().toISOString())
    } catch (e) {
        console.error('Error escribiendo heartbeat:', e)
    }
}
touchHeartbeat()
scheduledTasks.push(cron.schedule('* * * * *', touchHeartbeat))

// Cancel expired reservations and prune abandoned sessions every 30 min
scheduledTasks.push(cron.schedule('*/30 * * * *', async () => {
    pruneStaleSessions(sessions)
    if (!_prisma) return
    if (isDev) console.log('⏳ Checking for expired reservations...')

    try {
        const result = await expireReservations(_prisma)
        if (isDev) console.log('Reservation expiration', result)
    } catch (e) {
        console.error('Error in expiration job:', e)
    }
}))

// Purga diaria (04:17) de altas de negocio cuyo owner sigue PENDING — nunca
// verificaron su contacto. El endpoint /api/cron/purge-pending-signups usa
// la misma lógica para forzarla a mano o desde schedulers externos.
scheduledTasks.push(cron.schedule('17 4 * * *', async () => {
    if (!_prisma) return
    try {
        const result = await purgePendingSignups(_prisma)
        if (result.purged > 0 || result.purgedPendingCustomers > 0 || result.skipped.length > 0) {
            console.log('Pending signup purge:', result)
        }
    } catch (e) {
        console.error('Error in pending signup purge job:', e)
    }
}))

// Retención diaria (04:25) de bitácoras: AuditEvent >AUDIT_RETENTION_DAYS
// (default 90d) y PlatformEvent >PLATFORM_RETENTION_DAYS (default 365d).
// El endpoint /api/cron/purge-events usa la misma lógica para disparo manual.
scheduledTasks.push(cron.schedule('25 4 * * *', async () => {
    if (!_prisma) return
    try {
        const result = await purgeOldEvents(_prisma)
        if (result.auditDeleted > 0 || result.platformDeleted > 0) {
            console.log('Event retention purge:', result)
        }
    } catch (e) {
        console.error('Error in event retention job:', e)
    }
}))

// Reconciliación diaria (04:35) de delegaciones cross-tenant: la espejo en el
// tenant reparador y la marca local son commits separados — un fallo a media
// operación deja vínculos divergentes. El barrido solo DETECTA (issue en la
// respuesta + RepairEvent privado de alerta en la orden); la corrección es
// manual. El endpoint /api/cron/reconcile-delegations la dispara a mano.
scheduledTasks.push(cron.schedule('35 4 * * *', async () => {
    if (!_prisma) return
    try {
        const result = await reconcileDelegations(_prisma)
        if (result.issues.length > 0) {
            console.warn(`Delegation reconcile: ${result.issues.length} issue(s) en ${result.checked} vínculos (${result.annotated} alertas nuevas)`, result.issues)
        } else if (isDev) {
            console.log('Delegation reconcile: OK', result.checked)
        }
    } catch (e) {
        console.error('Error in delegation reconcile job:', e)
    }
}))

// ======= LAUNCH =======

// Node ≥22 aborta ante unhandled rejection: todo error que escape de un
// middleware/handler pasa por aquí en vez de tumbar el proceso.
bot.catch(err => {
    console.error('Bot error', err)
})

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
}).catch(err => {
    console.error('❌ Error fatal al iniciar el bot:', err)
    process.exit(1)
})

// ======= SHUTDOWN =======

// Docker envía SIGTERM al recrear el contenedor. bot.stop() solo corta el
// polling: los timers de node-cron y los sockets del pool pg mantienen vivo
// el event loop, así que el proceso colgaba hasta que Docker lo mataba a
// SIGKILL tras el timeout. Aquí se corta polling, se detienen los crons, se
// cierra Prisma y se sale; el setTimeout es la red de seguridad si el cierre
// ordenado se atasca.
let shuttingDown = false
function shutdown(signal: string) {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`🛑 ${signal} recibido: deteniendo bot…`)
    setTimeout(() => process.exit(0), 4_000).unref()
    try { bot.stop(signal) } catch (e) { console.error('Error deteniendo el bot:', e) }
    // Un bot parado no debe seguir pasando el healthcheck.
    try { fs.rmSync(HEARTBEAT_FILE, { force: true }) } catch { /* best-effort */ }
    for (const task of scheduledTasks) {
        try { task.stop() } catch { /* task ya detenido */ }
    }
    void Promise.resolve(_prisma?.$disconnect())
        .catch(e => console.error('Error cerrando Prisma:', e))
        .finally(() => process.exit(0))
}
process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
