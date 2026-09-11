import { Markup } from 'telegraf'
import { message } from 'telegraf/filters'
import type { BotContext } from '../lib/types'
import { requireAdmin } from '../lib/guards'

export function registerSettings({ bot, prisma, sessions }: BotContext) {
    // Helper to get setting value
    async function getSetting(key: string, defaultValue: string): Promise<string> {
        const setting = await prisma.systemSettings.findUnique({ where: { key } })
        return setting?.value || defaultValue
    }

    // Text handler for settings input (must be registered before other text handlers)
    bot.on(message('text'), async (ctx, next) => {
        const telegramId = ctx.from.id.toString()

        if (sessions.settings[telegramId]) {
            const session = sessions.settings[telegramId]
            const newValue = ctx.message.text.trim()

            try {
                await prisma.systemSettings.upsert({
                    where: { key: session.key },
                    update: { value: newValue },
                    create: { key: session.key, value: newValue }
                })

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

        const usd = await getSetting('usd_rate', '20.00')
        const hours = await getSetting('reservation_hours', '24')
        const bank = await getSetting('bank_info', 'BBVA | ProSolutions SA | 0123456789')

        await ctx.reply(`⚙️ *Ajustes del Sistema*

💵 *Dólar:* $${usd} MXN
⏳ *Expiración:* ${hours} horas
🏦 *Banco:* ${bank}

_Selecciona qué deseas modificar:_`, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('💵 Cambiar Dólar', 'set_usd')],
                [Markup.button.callback('⏳ Cambiar Horas', 'set_hours')],
                [Markup.button.callback('🏦 Cambiar Banco', 'set_bank')]
            ])
        })
    })

    bot.action(['set_usd', 'set_hours', 'set_bank'], async (ctx) => {
        if (!(await requireAdmin(ctx))) return
        const telegramId = ctx.from!.id.toString()

        const keyMap: Record<string, string> = {
            'set_usd': 'usd_rate',
            'set_hours': 'reservation_hours',
            'set_bank': 'bank_info'
        }
        const labelMap: Record<string, string> = {
            'set_usd': 'el precio del Dólar (ej: 20.50) (Referencia interna)',
            'set_hours': 'las horas de expiración (ej: 48)',
            'set_bank': 'la info del Banco (ej: Banco | Nombre | Cuenta)'
        }

        const action = ctx.match[0]
        const key = keyMap[action]

        sessions.settings[telegramId] = { key }

        await ctx.reply(`✏️ *Ingresa el nuevo valor para ${labelMap[action]}:*`)
        await ctx.answerCbQuery()
    })

    // Export getSetting for use in other modules
    return { getSetting }
}
