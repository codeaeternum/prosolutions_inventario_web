import { Markup } from 'telegraf'
import { message } from 'telegraf/filters'
import type { BotContext } from '../lib/types'
import { requireAdmin } from '../lib/guards'
import { DEFAULT_SETTINGS, getBusinessSetting, getDefaultBusinessId, setBusinessSetting } from '../../lib/settings'
import { escapeMarkdownV1 } from '../lib/format'

// Llave pseudo-interna: las horas de expiración NO viven en SystemSettings
// sino en la tabla Settings — la misma fila que lee domain/reservations.ts
// (pendingVerificationHours, 1-8760).
const KEY_PENDING_HOURS = 'pending_verification_hours'

export function registerSettings({ bot, prisma, sessions }: BotContext) {
    // Resuelve el negocio del usuario de Telegram que invoca el comando.
    async function businessIdOfTelegramUser(telegramId: string): Promise<string> {
        const me = await prisma.user.findUnique({
            where: { telegramId },
            select: { businessId: true }
        })
        return me?.businessId ?? (await getDefaultBusinessId())
    }

    // Helper to get setting value
    async function getSetting(businessId: string, key: string, defaultValue: string): Promise<string> {
        const setting = await getBusinessSetting(businessId, key)
        return setting || defaultValue
    }

    // Lee/escribe Settings.pendingVerificationHours (upsert por businessId —
    // la fila puede no existir todavía en un negocio nuevo).
    async function getPendingVerificationHours(businessId: string): Promise<number> {
        const row = await prisma.settings.findFirst({
            where: { businessId },
            select: { pendingVerificationHours: true }
        })
        return row?.pendingVerificationHours ?? DEFAULT_SETTINGS.pendingVerificationHours
    }

    async function setPendingVerificationHours(businessId: string, hours: number): Promise<void> {
        const existing = await prisma.settings.findFirst({ where: { businessId }, select: { id: true } })
        if (existing) {
            await prisma.settings.update({ where: { id: existing.id }, data: { pendingVerificationHours: hours } })
        } else {
            await prisma.settings.create({ data: { businessId, pendingVerificationHours: hours } })
        }
    }

    // Text handler for settings input (must be registered before other text handlers)
    bot.on(message('text'), async (ctx, next) => {
        const telegramId = ctx.from.id.toString()

        if (sessions.settings[telegramId]) {
            const session = sessions.settings[telegramId]
            const newValue = ctx.message.text.trim()

            // Un comando ("/cancelar", "/ajustes", …) no es un valor: se cede
            // al resto de handlers en vez de guardarlo como ajuste.
            if (newValue.startsWith('/')) return next()

            try {
                if (session.key === KEY_PENDING_HOURS) {
                    if (!/^\d+$/.test(newValue)) {
                        await ctx.reply('❌ Ingresa un número de horas válido (1-8760). Intenta de nuevo o usa /cancelar.')
                        return
                    }
                    const hours = parseInt(newValue, 10)
                    if (hours < 1 || hours > 8760) {
                        await ctx.reply('❌ Ingresa un número de horas válido (1-8760). Intenta de nuevo o usa /cancelar.')
                        return
                    }
                    await setPendingVerificationHours(session.businessId, hours)
                } else {
                    await setBusinessSetting(session.businessId, session.key, newValue)
                }

                delete sessions.settings[telegramId]
                await ctx.reply(`✅ *Ajuste guardado correctamente.*`, { parse_mode: 'Markdown' })
            } catch (e) {
                console.error(e)
                await ctx.reply('❌ Error al guardar ajuste.')
            }
            return
        }

        return next()
    })

    // /ajustes command
    bot.command('ajustes', async (ctx) => {
        if (!(await requireAdmin(ctx))) return

        const businessId = await businessIdOfTelegramUser(ctx.from.id.toString())
        const hours = await getPendingVerificationHours(businessId)
        const bankTransfer = await getSetting(businessId, 'bank_transfer_info', 'Sin configurar')
        const bankCash = await getSetting(businessId, 'bank_cash_info', 'Sin configurar')

        await ctx.reply(`⚙️ *Ajustes del Sistema*

⏳ *Horas p/ verificar depósito:* ${hours}
🏦 *Transferencia:* ${escapeMarkdownV1(bankTransfer)}
💵 *Depósito en efectivo:* ${escapeMarkdownV1(bankCash)}

_Selecciona qué deseas modificar:_`, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('⏳ Cambiar Horas', 'set_hours')],
                [Markup.button.callback('🏦 Datos de Transferencia', 'set_bank')],
                [Markup.button.callback('💵 Datos de Depósito', 'set_bank_cash')]
            ])
        })
    })

    bot.action(['set_hours', 'set_bank', 'set_bank_cash'], async (ctx) => {
        if (!(await requireAdmin(ctx))) return
        const telegramId = ctx.from!.id.toString()

        // Las llaves coinciden con las que lee el flujo real: catalog.ts usa
        // bank_transfer_info / bank_cash_info y domain/reservations.ts lee
        // Settings.pendingVerificationHours.
        const keyMap: Record<string, string> = {
            'set_hours': KEY_PENDING_HOURS,
            'set_bank': 'bank_transfer_info',
            'set_bank_cash': 'bank_cash_info'
        }
        const labelMap: Record<string, string> = {
            'set_hours': 'las horas para verificar un depósito (ej: 48)',
            'set_bank': 'los datos de transferencia/SPEI (ej: Banco | Nombre | CLABE)',
            'set_bank_cash': 'los datos de depósito en efectivo (ej: Banco | Nombre | Cuenta)'
        }

        const action = ctx.match[0]
        const key = keyMap[action]

        sessions.settings[telegramId] = { key, businessId: await businessIdOfTelegramUser(telegramId) }

        await ctx.reply(`✏️ *Ingresa el nuevo valor para ${labelMap[action]}:*`, { parse_mode: 'Markdown' })
        await ctx.answerCbQuery()
    })

    // Export getSetting for use in other modules
    return { getSetting }
}
