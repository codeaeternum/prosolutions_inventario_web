import * as cron from 'node-cron'
import type { Telegraf } from 'telegraf'
import type { PrismaClient } from '@prisma/client'
import type { BotContext } from '../lib/types'
import { notifyAdmins } from '../lib/notify'
import { clipMessage, escapeHtml } from '../lib/format'

/**
 * Stock Alert Module
 *
 * Chequeo horario de productos con stock=0 y aviso a los admins DE CADA
 * negocio. El cooldown es de 24 h por producto y es PERSISTENTE: la última
 * alerta se guarda en SystemSettings como `stock_alert_at_<productId>`
 * (epoch ms en `value`), así que un restart/recreate del contenedor del bot
 * ya no re-alerta todo el catálogo agotado. El Map en RAM queda como
 * fast-path dentro del proceso; el dato persistido es el que manda.
 *
 * Como en la versión en RAM, un producto que vuelve a tener stock resetea su
 * cooldown: su llave persistida se borra en el barrido (restock = el evento
 * agotado terminó — si se agota de nuevo SÍ corresponde avisar).
 */

// Fast-path en RAM (productId → timestamp). La fuente de verdad es
// SystemSettings; este Map solo evita releer/reevaluar dentro del proceso.
const notifiedProducts = new Map<string, number>()
const NOTIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000 // 24 hours

/** Vacía la fast-path en RAM. Solo para tests (aisla corridas entre sí). */
export function resetStockAlertCacheForTests(): void {
    notifiedProducts.clear()
}

/** Prefijo de la llave SystemSettings[businessId] con la última alerta. */
export const STOCK_ALERT_KEY_PREFIX = 'stock_alert_at_'

/** Máximo de productos listados por mensaje (el conteo total sí sale). */
const MAX_LISTED = 25

export interface StockAlertsResult {
    /** Productos agotados encontrados en el barrido. */
    outOfStock: number
    /** Productos que recibieron alerta nueva en esta corrida. */
    alerted: number
    /** Agotados saltados por el cooldown de 24 h (RAM o persistido). */
    deduped: number
}

/**
 * Un barrido completo: agotados → dedup por última alerta persistida →
 * aviso agrupado por negocio → marcas persistidas. Función sobre `prisma`
 * inyectado para que los tests la ejerciten con un cliente de mentira.
 */
export async function runStockAlerts(
    bot: Pick<Telegraf, 'telegram'>,
    prisma: Pick<PrismaClient, 'product' | 'systemSettings'>,
    isDev: boolean,
    now: Date = new Date(),
): Promise<StockAlertsResult> {
    const nowMs = now.getTime()

    const [outOfStock, persistedRows] = await Promise.all([
        prisma.product.findMany({
            where: { isActive: true, stock: { lte: 0 } },
            select: { id: true, name: true, stock: true, businessId: true },
            orderBy: { name: 'asc' }
        }),
        // Última alerta persistida por producto: `stock_alert_at_<productId>`
        // con epoch-ms en value. Una fila por producto alertado — volumen
        // chico, se leen todas para dedup + limpieza en una sola query.
        prisma.systemSettings.findMany({
            where: { key: { startsWith: STOCK_ALERT_KEY_PREFIX } },
            select: { key: true, value: true },
        }),
    ])

    const outIds = new Set(outOfStock.map(p => p.id))
    const lastPersisted = new Map<string, number>()
    const staleKeys: string[] = []
    for (const row of persistedRows) {
        const productId = row.key.slice(STOCK_ALERT_KEY_PREFIX.length)
        const ts = Number(row.value)
        // Restock o marca expirada/ilegible → llave obsoleta, se borra
        // (igual que la limpieza del Map: restock resetea el cooldown).
        if (!outIds.has(productId) || !Number.isFinite(ts) || (nowMs - ts) > NOTIFY_COOLDOWN_MS) {
            staleKeys.push(row.key)
            continue
        }
        const prev = lastPersisted.get(productId) ?? 0
        if (ts > prev) lastPersisted.set(productId, ts)
    }
    if (staleKeys.length > 0) {
        try {
            await prisma.systemSettings.deleteMany({ where: { key: { in: staleKeys } } })
        } catch (e) {
            // Best-effort: una llave zombie solo alarga un cooldown viejo.
            console.error('[Alerts] Error limpiando llaves de alerta viejas:', e)
        }
    }

    if (outOfStock.length === 0) {
        if (isDev) console.log('✅ [Alerts] All products have stock > 0')
        return { outOfStock: 0, alerted: 0, deduped: 0 }
    }

    // Dedup: la última alerta es max(RAM, persistida); >24 h vuelve a avisar.
    const newAlerts = outOfStock.filter(p => {
        const last = Math.max(notifiedProducts.get(p.id) ?? 0, lastPersisted.get(p.id) ?? 0)
        return last === 0 || (nowMs - last) >= NOTIFY_COOLDOWN_MS
    })

    if (newAlerts.length === 0) {
        if (isDev) console.log('ℹ️ [Alerts] All out-of-stock products already notified')
        return { outOfStock: outOfStock.length, alerted: 0, deduped: outOfStock.length }
    }

    // Multi-tenant: agrupar por empresa y avisar solo a SUS admins —
    // un negocio nunca ve los productos agotados de otro.
    const byBusiness = new Map<string, typeof newAlerts>()
    for (const p of newAlerts) {
        const list = byBusiness.get(p.businessId) ?? []
        list.push(p)
        byBusiness.set(p.businessId, list)
    }

    const alertWrites: { businessId: string; key: string; value: string }[] = []
    for (const [businessId, products] of byBusiness) {
        // La lista crece con el catálogo: sin tope el mensaje pasa de
        // 4096 chars, Telegram responde 400 y la alerta se pierde.
        const listed = products.slice(0, MAX_LISTED)
        let msg = `🚨 <b>¡Alerta de Stock Agotado!</b>\n\n`
        msg += `${products.length} producto(s) sin stock:\n\n`
        listed.forEach((p, i) => {
            msg += `${i + 1}. ❌ <b>${escapeHtml(p.name)}</b>\n`
        })
        if (products.length > listed.length) {
            msg += `…y ${products.length - listed.length} más\n`
        }
        msg += `\n⚠️ <i>Reponer inventario desde el panel web.</i>`
        await notifyAdmins(bot, businessId, clipMessage(msg))

        // Marcar como notificados TODOS los del mensaje — incluidos los que
        // no caben en la lista (el conteo "N producto(s)" ya los alertó).
        for (const p of products) {
            notifiedProducts.set(p.id, nowMs)
            alertWrites.push({ businessId, key: STOCK_ALERT_KEY_PREFIX + p.id, value: String(nowMs) })
        }
    }

    // Persistir las marcas: upsert por la llave compuesta (businessId, key).
    // Un fallo aquí no pierde la alerta de esta corrida (RAM ya la marcó);
    // solo permitiría re-aviso tras un restart — mejor que perderla.
    try {
        await Promise.all(alertWrites.map(w =>
            prisma.systemSettings.upsert({
                where: { businessId_key: { businessId: w.businessId, key: w.key } },
                update: { value: w.value },
                create: { businessId: w.businessId, key: w.key, value: w.value, type: 'NUMBER' },
            }),
        ))
    } catch (e) {
        console.error('[Alerts] Error persistiendo marcas de alerta:', e)
    }

    // Cleanup de la fast-path en RAM (productos que volvieron a tener stock).
    for (const [id, timestamp] of notifiedProducts.entries()) {
        if (!outIds.has(id) || (nowMs - timestamp) > NOTIFY_COOLDOWN_MS) {
            notifiedProducts.delete(id)
        }
    }

    if (isDev) console.log(`🔔 [Alerts] Sent alert for ${newAlerts.length} out-of-stock products`)
    return {
        outOfStock: outOfStock.length,
        alerted: newAlerts.length,
        deduped: outOfStock.length - newAlerts.length,
    }
}

export function registerAlerts({ bot, prisma, isDev }: BotContext): cron.ScheduledTask {
    // Check stock every hour
    const task = cron.schedule('0 * * * *', async () => {
        if (isDev) console.log('🔔 [Alerts] Checking for out-of-stock products...')

        try {
            await runStockAlerts(bot, prisma, isDev)
        } catch (e) {
            console.error('[Alerts] Error checking stock:', e)
        }
    })

    console.log('🔔 Stock alerts registered (hourly out-of-stock check)')
    // El handle se devuelve para que el shutdown de index.ts lo detenga.
    return task
}
