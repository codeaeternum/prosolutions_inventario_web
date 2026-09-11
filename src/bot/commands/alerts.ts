import * as cron from 'node-cron'
import type { BotContext } from '../lib/types'
import { notifyAdmins } from '../lib/notify'

/**
 * Stock Alert Module
 * 
 * Periodically checks for products with stock=0 and notifies admins.
 * Tracks already-notified product IDs to avoid spam (resets every 24h).
 */

// Track notified products to avoid spamming
const notifiedProducts = new Map<string, number>() // productId → timestamp
const NOTIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000 // 24 hours

export function registerAlerts({ bot, prisma, isDev }: BotContext) {
    // Check stock every hour
    cron.schedule('0 * * * *', async () => {
        if (isDev) console.log('🔔 [Alerts] Checking for out-of-stock products...')

        try {
            const outOfStock = await prisma.product.findMany({
                where: { isActive: true, stock: { lte: 0 } },
                select: { id: true, name: true, stock: true },
                orderBy: { name: 'asc' }
            })

            if (outOfStock.length === 0) {
                if (isDev) console.log('✅ [Alerts] All products have stock > 0')
                return
            }

            // Filter out recently notified products
            const now = Date.now()
            const newAlerts = outOfStock.filter(p => {
                const lastNotified = notifiedProducts.get(p.id)
                if (lastNotified && (now - lastNotified) < NOTIFY_COOLDOWN_MS) {
                    return false // Already notified within 24h
                }
                return true
            })

            if (newAlerts.length === 0) {
                if (isDev) console.log('ℹ️ [Alerts] All out-of-stock products already notified')
                return
            }

            // Build alert message
            let msg = `🚨 <b>¡Alerta de Stock Agotado!</b>\n\n`
            msg += `${newAlerts.length} producto(s) sin stock:\n\n`

            newAlerts.forEach((p, i) => {
                msg += `${i + 1}. ❌ <b>${p.name}</b>\n`
            })

            msg += `\n⚠️ <i>Reponer inventario desde el panel web.</i>`

            await notifyAdmins(bot, msg)

            // Mark as notified
            newAlerts.forEach(p => notifiedProducts.set(p.id, now))

            // Cleanup old entries (products that are back in stock)
            const activeProductIds = new Set(outOfStock.map(p => p.id))
            for (const [id, timestamp] of notifiedProducts.entries()) {
                if (!activeProductIds.has(id) || (now - timestamp) > NOTIFY_COOLDOWN_MS) {
                    notifiedProducts.delete(id)
                }
            }

            if (isDev) console.log(`🔔 [Alerts] Sent alert for ${newAlerts.length} out-of-stock products`)

        } catch (e) {
            console.error('[Alerts] Error checking stock:', e)
        }
    })

    console.log('🔔 Stock alerts registered (hourly out-of-stock check)')
}
