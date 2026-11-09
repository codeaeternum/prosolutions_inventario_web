import * as cron from 'node-cron'
import type { Telegraf } from 'telegraf'
import type { PrismaClient } from '@prisma/client'
import type { BotContext } from '../lib/types'
import { clipMessage, errorText, escapeHtml } from '../lib/format'
import { TELEGRAM_API_TIMEOUT_MS, withTimeout } from '../lib/utils'
import { deriveJornadas } from '../../lib/asistencia'
import { BUSINESS_TIME_ZONE, businessDayKey, parseBusinessDateParam } from '../../lib/business-time'

/**
 * Daily Summary Module
 *
 * Cron diario (20:00 hora del negocio): por cada negocio ACTIVO arma un
 * resumen del día-negocio (00:00 → ahora, America/Mexico_City) y lo envía
 * por DM a sus ADMIN con telegramId vinculado.
 *
 * Business no tiene campo timezone (constante de producto en
 * lib/business-time.ts): una sola programación `0 20 * * *` con
 * `timezone: America/Mexico_City` cubre a todos los tenants.
 */

const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const pesos = (cents: number) => mxn.format(cents / 100)
// Los montos persisten como Float en pesos (Sale.total, CashMovement.amount,
// CashRegister.initialAmount): la acumulación va en centavos enteros para no
// arrastrar error binario, mismo patrón que /api/reports y /caja.
const toCents = (v: number | null | undefined) => Math.round((v ?? 0) * 100)

// Ventana de checadas leídas para derivar jornadas: una jornada solo puede
// seguir `open` si su IN tiene <16 h (asistencia.ts), así que 48 h cubre con
// margen el IN y sus posibles OUT sin leer históricos enteros.
const CLOCK_WINDOW_MS = 48 * 60 * 60 * 1000

/** Subconjunto de PrismaClient que consume el resumen — testeable con dobles. */
export type DailySummaryDb = Pick<
    PrismaClient,
    'sale' | 'repairOrder' | 'cashRegister' | 'cashMovement' | 'clockEvent' | 'encargo' | 'reservation' | 'user'
>

export interface DailySummary {
    /** Día-negocio resumido (YYYY-MM-DD en America/Mexico_City). */
    dayKey: string
    sales: { count: number; totalCents: number }
    deliveredToday: number
    cash: { openRegisters: number; expectedCents: number }
    handoffs: { encargosReady: number; reservationsReady: number }
    openLongShifts: number
    longShiftNames: string[]
    /** Cuerpo del mensaje (HTML de Telegram), sin encabezado ni fecha. */
    lines: string[]
}

/**
 * Métricas del día-negocio de UN tenant. Función pura sobre `db` (sin bot):
 * los tests la ejercitan con un prisma de mentira.
 *
 * Decisiones de métrica:
 * - Ventas cobradas: Sale status COMPLETED del día (DRAFT/OPEN son documentos
 *   vivos, VOIDED se excluye — la misma regla que /api/reports). Lo cobrado =
 *   total (catálogo) − discountCents autorizado al cobrar.
 * - Taller entregado hoy: RepairOrder status DELIVERED con updatedAt en el
 *   día — el modelo no tiene deliveredAt; updatedAt como fecha de entrega es
 *   la convención que ya usa /api/actividad/desempeno.
 * - Efectivo en cajas abiertas: initialAmount + Σ IN − Σ OUT de cada
 *   CashRegister OPEN (CashMovementType solo tiene IN/OUT; no hay ADJUST).
 * - Turnos >10h: ClockEvents de las últimas 48 h por usuario →
 *   deriveJornadas → jornadas `open && longShift` (IN sin OUT con ≥10 h y
 *   <16 h; a las 16 h la jornada queda abandonada, no "larga").
 * - Por entregar: encargos READY (pieza llegó, falta entregar) + reservas
 *   APPROVED (listas para recoger) — conteos triviales que el modelo permite.
 */
export async function buildDailySummary(db: DailySummaryDb, businessId: string, now: Date = new Date()): Promise<DailySummary> {
    const dayKey = businessDayKey(now)
    // 00:00:00 del día-negocio en la zona del negocio (instante UTC real).
    const dayStart = parseBusinessDateParam(dayKey, 'start') ?? now

    const [sales, deliveredToday, openRegisters, clockEvents, encargosReady, reservationsReady] = await Promise.all([
        db.sale.findMany({
            where: { businessId, status: 'COMPLETED', createdAt: { gte: dayStart, lte: now } },
            select: { total: true, discountCents: true },
        }),
        db.repairOrder.count({
            where: { businessId, status: 'DELIVERED', updatedAt: { gte: dayStart, lte: now } },
        }),
        db.cashRegister.findMany({
            where: { businessId, status: 'OPEN' },
            select: { id: true, initialAmount: true },
        }),
        db.clockEvent.findMany({
            where: { businessId, at: { gte: new Date(now.getTime() - CLOCK_WINDOW_MS) } },
            select: { id: true, userId: true, type: true, at: true, branchId: true, user: { select: { name: true } } },
            orderBy: { at: 'asc' },
        }),
        db.encargo.count({ where: { businessId, status: 'READY' } }),
        db.reservation.count({ where: { businessId, status: 'APPROVED' } }),
    ])

    let salesTotalCents = 0
    for (const s of sales) salesTotalCents += toCents(s.total) - s.discountCents

    // Efectivo neto esperado en las cajas que siguen abiertas ahora mismo.
    let expectedCents = 0
    for (const r of openRegisters) expectedCents += toCents(r.initialAmount)
    if (openRegisters.length > 0) {
        const movements = await db.cashMovement.findMany({
            where: { registerId: { in: openRegisters.map(r => r.id) } },
            select: { amount: true, type: true },
        })
        for (const m of movements) expectedCents += (m.type === 'IN' ? 1 : -1) * toCents(m.amount)
    }

    // Jornadas por usuario: cada IN abre una y el siguiente OUT la cierra.
    const byUser = new Map<string, { name: string; events: typeof clockEvents }>()
    for (const e of clockEvents) {
        const entry = byUser.get(e.userId) ?? { name: e.user?.name ?? 'Sin nombre', events: [] }
        entry.events.push(e)
        byUser.set(e.userId, entry)
    }
    const longShiftNames: string[] = []
    for (const { name, events } of byUser.values()) {
        if (deriveJornadas(events, now).some(j => j.open && j.longShift)) longShiftNames.push(name)
    }

    const lines: string[] = []
    lines.push(sales.length === 0
        ? '🛒 Sin ventas hoy.'
        : `🛒 Ventas cobradas: <b>${sales.length}</b> · <b>${pesos(salesTotalCents)}</b>`)
    lines.push(`🔧 Órdenes de taller entregadas hoy: <b>${deliveredToday}</b>`)
    lines.push(openRegisters.length === 0
        ? '💵 Sin cajas abiertas.'
        : `💵 Efectivo en cajas abiertas: <b>${pesos(expectedCents)}</b> (${openRegisters.length} ${openRegisters.length === 1 ? 'caja' : 'cajas'})`)
    const handoffParts: string[] = []
    if (encargosReady > 0) handoffParts.push(`${encargosReady} ${encargosReady === 1 ? 'encargo listo' : 'encargos listos'}`)
    if (reservationsReady > 0) handoffParts.push(`${reservationsReady} ${reservationsReady === 1 ? 'reserva' : 'reservas'} por recoger`)
    if (handoffParts.length > 0) lines.push(`📦 Por entregar: <b>${handoffParts.join(' · ')}</b>`)
    if (longShiftNames.length > 0) {
        lines.push(`⚠️ Turnos abiertos >10h: <b>${longShiftNames.length}</b> (${longShiftNames.map(escapeHtml).join(', ')})`)
    }

    return {
        dayKey,
        sales: { count: sales.length, totalCents: salesTotalCents },
        deliveredToday,
        cash: { openRegisters: openRegisters.length, expectedCents },
        handoffs: { encargosReady, reservationsReady },
        openLongShifts: longShiftNames.length,
        longShiftNames,
        lines,
    }
}

/** Mensaje completo (HTML): encabezado con nombre del negocio + fecha + cuerpo. */
export function formatDailySummaryMessage(businessName: string, summary: DailySummary, now: Date = new Date()): string {
    const fecha = now.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: BUSINESS_TIME_ZONE })
    return clipMessage(`📊 <b>Resumen del día — ${escapeHtml(businessName)}</b>\n📅 ${fecha}\n\n${summary.lines.join('\n')}`)
}

/** Admins del tenant con Telegram vinculado — audiencia del resumen. */
export function dailySummaryRecipients(db: Pick<DailySummaryDb, 'user'>, businessId: string) {
    return db.user.findMany({
        where: { businessId, role: 'ADMIN', status: 'APPROVED', telegramId: { not: null } },
        // id para los logs de envío fallido (el nombre/telegramId son PII).
        select: { id: true, name: true, telegramId: true },
    })
}

/**
 * Envía `message` a cada admin con telegramId del negocio. Un envío fallido
 * (chat bloqueado, id obsoleto) se anota y NO interrumpe a los demás.
 * Devuelve cuántos mensajes se entregaron (0 cuando no hay destinatarios).
 */
export async function sendDailySummaryToAdmins(
    bot: Pick<Telegraf, 'telegram'>,
    db: Pick<DailySummaryDb, 'user'>,
    businessId: string,
    message: string,
): Promise<number> {
    const admins = await dailySummaryRecipients(db, businessId)
    let sent = 0
    for (const admin of admins) {
        if (!admin.telegramId) continue
        try {
            await withTimeout(
                bot.telegram.sendMessage(admin.telegramId, message, { parse_mode: 'HTML' }),
                TELEGRAM_API_TIMEOUT_MS,
                'sendMessage de resumen diario',
            )
            sent++
        } catch (e) {
            // Sin nombre/telegramId ni el error crudo de Telegraf: el id del
            // usuario basta para encontrar al admin afectado en la BD.
            console.warn(`[DailySummary] No se pudo enviar al admin ${admin.id}:`, errorText(e))
        }
    }
    return sent
}

/**
 * Un barrido completo: negocios activos → resumen → DM a sus admins. Cada
 * negocio corre aislado: si uno falla, los demás sí reciben su resumen.
 */
export async function runDailySummary(bot: Pick<Telegraf, 'telegram'>, db: PrismaClient, isDev: boolean, now: Date = new Date()): Promise<void> {
    const businesses = await db.business.findMany({ where: { isActive: true }, select: { id: true, name: true } })
    for (const business of businesses) {
        try {
            const summary = await buildDailySummary(db, business.id, now)
            const message = formatDailySummaryMessage(business.name, summary, now)
            const sent = await sendDailySummaryToAdmins(bot, db, business.id, message)
            if (isDev) console.log(`📊 [DailySummary] ${business.name}: ${sent} admin(s) notificados`)
        } catch (e) {
            console.error(`[DailySummary] Error con el negocio ${business.id}:`, errorText(e))
        }
    }
}

export function registerDailySummary({ bot, prisma, isDev }: BotContext): cron.ScheduledTask {
    // 20:00 hora del negocio. Business no tiene timezone propio: la zona es
    // constante de producto (BUSINESS_TIME_ZONE), así que una sola
    // programación horaria cubre a todos los tenants.
    const task = cron.schedule('0 20 * * *', async () => {
        if (isDev) console.log('📊 [DailySummary] Generando resúmenes diarios…')
        try {
            await runDailySummary(bot, prisma, isDev)
        } catch (e) {
            console.error('[DailySummary] Error en el barrido diario:', e)
        }
    }, { timezone: BUSINESS_TIME_ZONE })

    console.log(`📊 Daily summary registered (daily 20:00 ${BUSINESS_TIME_ZONE})`)
    // El handle se devuelve para que el shutdown de index.ts lo detenga.
    return task
}
