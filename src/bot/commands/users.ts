import { submitRegistration, escapeHtml } from "../lib/registration"
import { Markup } from 'telegraf'
import type { BotContext } from '../lib/types'
import { isAdmin } from '../lib/notify'
import { getBotAccount, requireAdmin, requirePrisma } from '../lib/guards'
import { normalizePhone } from '../lib/utils'

export function registerUsers({ bot, prisma, sessions }: BotContext) {
    // /admin panel
    bot.command('admin', async (ctx) => {
        if (!(await requireAdmin(ctx))) return
        await ctx.reply(`👑 *Panel de Administración*

📦 *Gestión de Productos:*
/agregar - Agregar nuevo producto
/stock - Actualizar stock (ej: /stock 123 50)
/eliminar \<producto\> - Eliminar producto

🛒 *Ventas en Local:*
/vender \<producto\> - Venta rápida (1 producto)
/carrito - Ver carrito actual
/agregarc \<producto\> - Agregar al carrito
/confirmarc - Confirmar venta del carrito
/vaciarc - Vaciar carrito
/qr \<producto\> - Obtener código QR

👥 *Gestión de Usuarios:*
/makeadmin \<telefono|telegram_id\> - Hacer administrador
/removeadmin \<telefono|telegram_id\> - Quitar administrador

📊 *Reportes y Operaciones:*
/pendientes - Ver reservas pendientes
/caja - Estado de la caja registradora
/credito - Deudores y saldos de crédito
/reporte - Resumen del día

🔔 *Notificaciones:*
Las alertas de nuevos pedidos llegarán aquí.

_Usa /cancelar para salir de cualquier proceso._`, { parse_mode: 'Markdown' })
    })

    // /makeadmin
    bot.command('makeadmin', async (ctx) => {
        if (!(await requireAdmin(ctx))) return
        if (!(await requirePrisma(ctx))) return

        const args = ctx.message.text.split(' ')
        if (args.length !== 2) {
            return ctx.reply('Uso: /makeadmin <telefono|telegram_id>\nEj: /makeadmin 5512345678')
        }

        const identifier = args[1].trim()

        try {
            // Multi-tenant: solo puede promover usuarios de SU negocio.
            const actor = await getBotAccount(prisma, ctx.from.id.toString())
            if (!actor) return ctx.reply('Cuenta no disponible.')

            const user = await prisma.user.findFirst({
                where: {
                    businessId: actor.businessId,
                    OR: [
                        { phone: { contains: identifier } },
                        { telegramId: identifier }
                    ]
                }
            })

            if (!user) {
                return ctx.reply('❌ Usuario no encontrado. Verifica el teléfono o Telegram ID.')
            }

            if (user.role === 'ADMIN') {
                return ctx.reply(`⚠️ *${escapeHtml(user.name)}* ya es administrador.`, { parse_mode: 'Markdown' })
            }

            await prisma.user.update({
                where: { id: user.id },
                data: { role: 'ADMIN' }
            })

            await ctx.reply(`✅ *${escapeHtml(user.name)}* ahora es administrador. 👑

📱 Tel: ${user.phone || 'N/A'}
🆔 Telegram: ${user.telegramId || 'N/A'}`, { parse_mode: 'Markdown' })

            if (user.telegramId) {
                bot.telegram.sendMessage(user.telegramId, `👑 *¡Ahora eres Administrador!*

Un administrador te ha otorgado permisos de administrador.
Usa /admin para ver el panel de administración.`, { parse_mode: 'Markdown' }).catch(() => { })
            }

        } catch (e) {
            console.error('Error making admin:', e)
            await ctx.reply('❌ Error al procesar la solicitud.')
        }
    })

    // /removeadmin
    bot.command('removeadmin', async (ctx) => {
        if (!(await requireAdmin(ctx))) return
        if (!(await requirePrisma(ctx))) return

        const telegramId = ctx.from.id.toString()
        const args = ctx.message.text.split(' ')
        if (args.length !== 2) {
            return ctx.reply('Uso: /removeadmin <telefono|telegram_id>\nEj: /removeadmin 5512345678')
        }

        const identifier = args[1].trim()

        try {
            // Multi-tenant: solo puede degradar admins de SU negocio.
            const actor = await getBotAccount(prisma, telegramId)
            if (!actor) return ctx.reply('Cuenta no disponible.')

            const user = await prisma.user.findFirst({
                where: {
                    businessId: actor.businessId,
                    OR: [
                        { phone: { contains: identifier } },
                        { telegramId: identifier }
                    ]
                }
            })

            if (!user) {
                return ctx.reply('❌ Usuario no encontrado. Verifica el teléfono o Telegram ID.')
            }

            if (user.role !== 'ADMIN') {
                return ctx.reply(`⚠️ *${escapeHtml(user.name)}* no es administrador.`, { parse_mode: 'Markdown' })
            }

            if (user.telegramId === telegramId) {
                return await ctx.reply('❌ No puedes quitarte el rol de administrador a ti mismo.')
            }

            await prisma.user.update({
                where: { id: user.id },
                data: { role: 'CUSTOMER' }
            })

            await ctx.reply(`✅ *${escapeHtml(user.name)}* ya no es administrador.

📱 Tel: ${user.phone || 'N/A'}
🆔 Telegram: ${user.telegramId || 'N/A'}`, { parse_mode: 'Markdown' })

            if (user.telegramId) {
                bot.telegram.sendMessage(user.telegramId, `ℹ️ *Tu rol de administrador ha sido removido.*

Ahora tienes acceso como cliente regular.`, { parse_mode: 'Markdown' }).catch(() => { })
            }

        } catch (e) {
            console.error('Error removing admin:', e)
            await ctx.reply('❌ Error al procesar la solicitud.')
        }
    })

    // Registration type buttons
    bot.action(/^reg_type_(\d+)$/, async (ctx) => {
        const typeId = ctx.match[1]
        const telegramId = ctx.from.id.toString()
        const regSession = sessions.registration[telegramId]

        if (!regSession || regSession.step !== 'TYPE') {
            return ctx.answerCbQuery('⚠️ Sesión expirada o paso incorrecto.')
        }

        await ctx.answerCbQuery()

        if (typeId === '1') {
            regSession.data.customerType = 'TECHNICIAN'
            regSession.step = 'BUSINESS'
            await ctx.editMessageText('🔧 <b>Excelente!</b>\n\n¿Cuál es el nombre de tu taller?', { parse_mode: 'HTML' })
        } else if (typeId === '2') {
            regSession.data.customerType = 'STORE'
            regSession.step = 'BUSINESS'
            await ctx.editMessageText('🏪 <b>Perfecto!</b>\n\n¿Cuál es el nombre de tu tienda?', { parse_mode: 'HTML' })
        } else if (typeId === '3') {
            regSession.data.customerType = 'NORMAL'
            regSession.step = 'PHONE'
            await ctx.editMessageText('3️⃣ <b>¿Cuál es tu número de teléfono?</b>\n(Para contactarte por tus pedidos)', { parse_mode: 'HTML' })
        }
    })

    // Registration goal buttons
    bot.action(/^reg_goal_(\d+)$/, async (ctx) => {
        const goalValue = parseInt(ctx.match[1], 10)
        const telegramId = ctx.from.id.toString()
        const regSession = sessions.registration[telegramId]

        if (!regSession || regSession.step !== 'GOAL') {
            await ctx.answerCbQuery('⚠️ Sesión expirada o paso incorrecto.')
            return
        }

        await ctx.answerCbQuery()

        const goal = goalValue === 0 ? null : goalValue

        try {
            await submitRegistration({ prisma, bot, sessions }, ctx, goal ?? 0)
        } catch (e) {
            console.error('[RegWizard] DB Error (goal button):', e)
            delete sessions.registration[telegramId]
            await ctx.reply('⚠️ Hubo un error guardando tu registro. Intenta de nuevo con /start')
        }
    })

    // Contact handler (phone sharing)
    bot.on('contact' as any, async (ctx: any) => {
        const telegramId = ctx.from.id.toString()
        const regSession = sessions.registration[telegramId]
        if (!regSession || regSession.step !== 'PHONE') return
        const phone = ctx.message.contact.phone_number
        if (!phone) {
            await ctx.reply('❌ No se pudo leer el número. Escribe tu teléfono, ej: 5512345678')
            return
        }
        regSession.data.phone = normalizePhone(phone)
        regSession.step = 'GOAL'
        await ctx.reply(`5️⃣ <b>¿Cuánto esperas comprar al mes aproximadamente?</b>

Esto nos ayuda a darte mejor atención. Selecciona una opción:`, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🤷 No sé', 'reg_goal_0')],
                [Markup.button.callback('💰 Menos de $5,000', 'reg_goal_5000')],
                [Markup.button.callback('💰 $5,000 - $15,000', 'reg_goal_10000')],
                [Markup.button.callback('💰 Más de $15,000', 'reg_goal_20000')]
            ])
        })
    })

    // Approve user
    bot.action(/^approve_user_(.+)$/, async (ctx) => {
        const userId = ctx.match[1]
        if (!(await isAdmin(ctx.from.id.toString()))) {
            return ctx.answerCbQuery('Solo administradores pueden hacer esto')
        }

        try {
            // Multi-tenant: un admin solo aprueba solicitudes de SU negocio.
            const actor = await getBotAccount(prisma, ctx.from.id.toString())
            if (!actor) return ctx.answerCbQuery('Cuenta no disponible')
            const target = await prisma.user.findFirst({ where: { id: userId, businessId: actor.businessId } })
            if (!target) {
                await ctx.answerCbQuery('Usuario no encontrado')
                return ctx.editMessageText('❌ Solicitud no encontrada en tu negocio.')
            }

            const user = await prisma.user.update({
                where: { id: target.id },
                data: { status: 'APPROVED' }
            })

            await ctx.answerCbQuery('Usuario aprobado')
            await ctx.editMessageText(`✅ <b>Usuario Aprobado</b>\n\n📛 ${escapeHtml(user.name)}\n📱 ${escapeHtml(user.phone)}`, { parse_mode: 'HTML' })

            if (user.telegramId) {
                bot.telegram.sendMessage(user.telegramId, `🎉 <b>¡Tu cuenta ha sido aprobada!</b>\n\nYa puedes ver precios, buscar productos y realizar reservas en nuestro bot.\n\nEscribe "Hola" o el nombre de un producto para comenzar.`, { parse_mode: 'HTML' })
            }
        } catch (e) {
            console.error(e)
            ctx.answerCbQuery('Error al aprobar')
        }
    })

    // Reject user
    bot.action(/^reject_user_(.+)$/, async (ctx) => {
        const userId = ctx.match[1]
        if (!(await isAdmin(ctx.from.id.toString()))) {
            return ctx.answerCbQuery('Solo administradores pueden hacer esto')
        }

        try {
            // Multi-tenant: un admin solo rechaza solicitudes de SU negocio.
            const actor = await getBotAccount(prisma, ctx.from.id.toString())
            if (!actor) return ctx.answerCbQuery('Cuenta no disponible')
            const target = await prisma.user.findFirst({ where: { id: userId, businessId: actor.businessId } })
            if (!target) {
                await ctx.answerCbQuery('Usuario no encontrado')
                return ctx.editMessageText('❌ Solicitud no encontrada en tu negocio.')
            }

            const user = await prisma.user.update({
                where: { id: target.id },
                data: { status: 'REJECTED' }
            })

            await ctx.answerCbQuery('Usuario rechazado')
            await ctx.editMessageText(`❌ <b>Usuario Rechazado</b>\n\n📛 ${escapeHtml(user.name)}\n📱 ${escapeHtml(user.phone)}`, { parse_mode: 'HTML' })
        } catch (e) {
            console.error(e)
            ctx.answerCbQuery('Error al rechazar')
        }
    })
}
