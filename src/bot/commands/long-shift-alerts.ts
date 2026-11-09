import * as cron from 'node-cron'
import type { Telegraf } from 'telegraf'
import type { PrismaClient } from '@prisma/client'
import type { BotContext } from '../lib/types'
import { clipMessage, errorText, escapeHtml } from '../lib/format'
import { TELEGRAM_API_TIMEOUT_MS, withTimeout } from '../lib/utils'
import { deriveJornadas } from '../../lib/asistencia'
import { BUSINESS_TIME_ZONE, businessDayKey } from '../../lib/business-time'

/**
 * Long Shift Alerts Module
 *
 * Cron horario (a los :15, desfasado del chequeo de stock de :00): por cada
 * negocio ACTIVO deriva las jornadas de sus ClockEvents recientes y hace un
 * ping por Telegram al empleado cuya jornada sigue abierta con >=10 h
 * (`open && longShift`, es decir entre 10 h y 16 h — pasadas 16 h queda
 * `openEnded`/abandonada y ya no se persigue).
 *
 * A diferencia del resumen diario (que avisa a los ADMINS a las 20:00) esta
 * alerta va al PROPIO empleado a tiempo: su utilidad es evitar turnos que se
 * quedan abiertos por olvido.
 *
 * Dedup persistente: Notification no tiene userId (es por negocio+audiencia,
 * la lectura vive en NotificationRead), así que el usuario viaja en
 * `data.userId` (JSONB) y la deduplicación filtra por ese path + createdAt
 * dentro de la MISMA jornada (>= el IN que la abrió). La fila además es la
 * que el staff ve en la campana web (audience STAFF: el empleado y los
 * admins la ven — a un admin también le sirve enterarse del turno largo).
 * La Notification solo se crea tras un envío de Telegram EXITOSO: un chat
 * bloqueado o un sendMessage fallido no deja dedup y la siguiente hora
 * reintenta.
 */

// Una jornada solo puede seguir `open` si su IN tiene <16 h (asistencia.ts):
// 48 h cubre con margen el IN y sus OUTs sin leer históricos enteros.
const CLOCK_WINDOW_MS = 48 * 60 * 60 * 1000

/** Tipo persistido en Notification (snake_case como los del stream SSE). */
export const LONG_SHIFT_NOTIFICATION_TYPE = 'long_shift'

/** Subconjunto de PrismaClient que consume el módulo — testeable con dobles. */
export type LongShiftDb = Pick<PrismaClient, 'business' | 'clockEvent' | 'notification'>

export interface LongOpenShift {
    businessId: string
    businessName: string
    userId: string
    name: string
    telegramId: string | null
    /** Instante del IN que abrió la jornada. */
    since: Date
    /** Minutos corridos al momento del barrido (>=600 por ser longShift). */
    elapsedMin: number
}

/**
 * Jornadas `open && longShift` de todos los negocios activos. Función pura
 * sobre `db` (sin bot): los tests la ejercitan con un prisma de mentira.
 *
 * Cada negocio corre aislado: un fallo leyendo sus checadas se anota con warn
 * y NO interrumpe el barrido de los demás. Usuarios no APPROVED no generan
 * candidatos (misma regla que el gate de cuenta del bot).
 */
export async function findLongOpenShifts(db: LongShiftDb, now: Date = new Date()): Promise<LongOpenShift[]> {
    const businesses = await db.business.findMany({
        where: { isActive: true },
        select: { id: true, name: true, isActive: true },
    })
    const shifts: LongOpenShift[] = []
    for (const business of businesses) {
        // Defensa extra además del filtro de la consulta: un tenant
        // suspendido jamás genera pings a su gente.
        if (!business.isActive) continue
        try {
            const events = await db.clockEvent.findMany({
                where: { businessId: business.id, at: { gte: new Date(now.getTime() - CLOCK_WINDOW_MS) } },
                select: {
                    id: true, userId: true, type: true, at: true, branchId: true,
                    user: { select: { name: true, telegramId: true, status: true } },
                },
                orderBy: { at: 'asc' },
            })
            const byUser = new Map<string, { name: string; telegramId: string | null; status: string; events: typeof events }>()
            for (const e of events) {
                const entry = byUser.get(e.userId) ?? {
                    name: e.user?.name ?? 'Sin nombre',
                    telegramId: e.user?.telegramId ?? null,
                    status: e.user?.status ?? '',
                    events: [] as typeof events,
                }
                entry.events.push(e)
                byUser.set(e.userId, entry)
            }
            for (const [userId, info] of byUser) {
                if (info.status !== 'APPROVED') continue
                // deriveJornadas deja a lo sumo UNA jornada abierta por usuario.
                const j = deriveJornadas(info.events, now).find(x => x.open && x.longShift)
                if (!j) continue
                shifts.push({
                    businessId: business.id,
                    businessName: business.name,
                    userId,
                    name: info.name,
                    telegramId: info.telegramId,
                    since: new Date(j.inAt),
                    elapsedMin: j.minutos ?? 0,
                })
            }
        } catch (e) {
            // Sin business.name ni el error crudo: el id basta para ubicar el
            // tenant y el mensaje truncado no filtra PII ni datos de la query.
            console.warn(`[LongShift] Error leyendo checadas del negocio ${business.id}:`, errorText(e))
        }
    }
    return shifts
}

const timeFmt = new Intl.DateTimeFormat('es-MX', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: BUSINESS_TIME_ZONE,
})
const dayFmt = new Intl.DateTimeFormat('es-MX', {
    day: '2-digit', month: '2-digit', timeZone: BUSINESS_TIME_ZONE,
})

/**
 * "HH:MM" del IN en la zona del negocio; si la jornada empezó otro
 * día-negocio se antepone dd/MM ("04/02 22:15") para que no se lea como hoy.
 */
export function formatShiftStart(since: Date, now: Date = new Date()): string {
    const hm = timeFmt.format(since)
    return businessDayKey(since) === businessDayKey(now) ? hm : `${dayFmt.format(since)} ${hm}`
}

/** Cuerpo del DM al empleado (HTML de Telegram), nombre escapado. */
export function formatLongShiftMessage(shift: LongOpenShift, now: Date = new Date()): string {
    const horas = Math.floor(shift.elapsedMin / 60)
    return clipMessage(
        `⏰ <b>${escapeHtml(shift.name)}</b>: llevas más de ${horas} h con tu turno abierto ` +
        `(desde las ${formatShiftStart(shift.since, now)}). ` +
        `Si ya terminaste, marca tu salida en el Checador.`)
}

export interface LongShiftSendResult {
    /** DMs de Telegram entregados. */
    sent: number
    /** Jornadas saltadas porque ya existía Notification de esta jornada. */
    deduped: number
    /** Jornadas largas de usuarios sin telegramId (no hay a quién pinguear). */
    noTelegram: number
    /** Jornadas cuyo envío/dedup falló; la siguiente hora reintentan. */
    failed: number
}

/**
 * Ping por Telegram para cada jornada larga. Por usuario:
 * 1. Sin telegramId → skip (ni dedup: la alerta vive solo en Telegram).
 * 2. Ya existe Notification `long_shift` con data.userId = userId y
 *    createdAt >= el IN de la jornada → skip (una sola alerta por jornada).
 * 3. sendMessage HTML → Notification de dedup (title "Turno prolongado").
 *    Un sendMessage rechazado NO crea dedup: reintenta en el próximo tick.
 *    Un fallo del insert de dedup tras un ping exitoso solo se anota — el
 *    costo es un posible re-ping en la próxima hora, mejor que el silencio.
 * Un usuario nunca detiene a los demás (try/catch por jornada).
 */
export async function sendLongShiftAlerts(
    bot: Pick<Telegraf, 'telegram'>,
    db: Pick<LongShiftDb, 'notification'>,
    shifts: LongOpenShift[],
    now: Date = new Date(),
): Promise<LongShiftSendResult> {
    const result: LongShiftSendResult = { sent: 0, deduped: 0, noTelegram: 0, failed: 0 }
    for (const shift of shifts) {
        if (!shift.telegramId) {
            result.noTelegram++
            continue
        }
        try {
            const already = await db.notification.findFirst({
                where: {
                    businessId: shift.businessId,
                    type: LONG_SHIFT_NOTIFICATION_TYPE,
                    createdAt: { gte: shift.since },
                    data: { path: ['userId'], equals: shift.userId },
                },
                select: { id: true },
            })
            if (already) {
                result.deduped++
                continue
            }

            await withTimeout(
                bot.telegram.sendMessage(shift.telegramId, formatLongShiftMessage(shift, now), { parse_mode: 'HTML' }),
                TELEGRAM_API_TIMEOUT_MS,
                'sendMessage de turno largo',
            )
            result.sent++

            const horas = Math.floor(shift.elapsedMin / 60)
            try {
                await db.notification.create({
                    data: {
                        businessId: shift.businessId,
                        type: LONG_SHIFT_NOTIFICATION_TYPE,
                        // STAFF = la ve el EMPLOYEE afectado y también los
                        // ADMIN del negocio en la campana web.
                        audience: 'STAFF',
                        title: 'Turno prolongado',
                        message: `${shift.name} lleva más de ${horas} h con su turno abierto (desde las ${formatShiftStart(shift.since, now)}).`,
                        data: { userId: shift.userId, shiftStart: shift.since.toISOString() },
                    },
                })
            } catch (e) {
                console.warn(`[LongShift] Ping enviado al userId ${shift.userId} pero la Notification de dedup falló (puede re-pinguear en la próxima hora):`, errorText(e))
            }
        } catch (e) {
            result.failed++
            // Sin nombre/telegramId ni el TelegrafError crudo (su `on` lleva
            // el payload del sendMessage): userId+businessId identifican la jornada.
            console.warn(`[LongShift] No se pudo alertar (userId ${shift.userId}, negocio ${shift.businessId}):`, errorText(e))
        }
    }
    return result
}

/**
 * Un barrido completo: negocios activos → jornadas largas → DM a sus
 * empleados. Devuelve los contadores del envío para el log del caller.
 */
export async function runLongShiftAlerts(
    bot: Pick<Telegraf, 'telegram'>,
    db: LongShiftDb,
    isDev: boolean,
    now: Date = new Date(),
): Promise<LongShiftSendResult> {
    const shifts = await findLongOpenShifts(db, now)
    if (shifts.length === 0) {
        if (isDev) console.log('⏰ [LongShift] Sin turnos abiertos >10h')
        return { sent: 0, deduped: 0, noTelegram: 0, failed: 0 }
    }
    const result = await sendLongShiftAlerts(bot, db, shifts, now)
    if (isDev) {
        console.log(`⏰ [LongShift] ${result.sent} alerta(s) enviadas · ${result.deduped} dedup · ${result.noTelegram} sin Telegram · ${result.failed} fallo(s)`)
    }
    return result
}

export function registerLongShiftAlerts({ bot, prisma, isDev }: BotContext): cron.ScheduledTask {
    // A los :15 de cada hora, desfasado del chequeo de stock (:00) para que
    // los dos barridos no colisionen. SIN timezone: el umbral es por duración
    // (≥10 h corridas desde el IN), así que la zona del negocio es
    // irrelevante para cuándo dispara el tick.
    const task = cron.schedule('15 * * * *', async () => {
        if (isDev) console.log('⏰ [LongShift] Revisando turnos abiertos >10h…')
        try {
            await runLongShiftAlerts(bot, prisma, isDev)
        } catch (e) {
            console.error('[LongShift] Error en el barrido horario:', e)
        }
    })

    console.log('⏰ Long-shift alerts registered (hourly at :15, >10h open shifts)')
    // El handle se devuelve para que el shutdown de index.ts lo detenga.
    return task
}
