import { submitRegistration } from "../lib/registration"
import { Markup } from 'telegraf'
import type { Context } from 'telegraf'
import type { PrismaClient } from '@/generated/prisma/client'
import type { BotContext } from '../lib/types'
import { customerTypeLabels } from '../lib/types'
import { getBotAccount, requireAdmin, requireAdminAccount, requirePrisma } from '../lib/guards'
import { normalizePhone } from '../lib/utils'
import { normalizePhone as normalizePhoneLookup } from '../../lib/utils'
import { escapeHtml, errorText, escapeMarkdownV1 } from '../lib/format'
import { recordAudit } from '../../lib/audit'

/** Tope de candidatos listados para confirmar /makeadmin /removeadmin. */
const MAX_ADMIN_CANDIDATES = 5

type AdminTargetUser = {
    id: string
    name: string
    phone: string | null
    telegramId: string | null
    role: string
    status: string
}

const ADMIN_TARGET_SELECT = {
    id: true, name: true, phone: true, telegramId: true, role: true, status: true,
} as const

/**
 * Resolución estricta del objetivo de /makeadmin /removeadmin.
 *
 * Antes: `findFirst({ phone: { contains } })` sin orderBy — un fragmento
 * corto ("55", "1") promovía/degradaba al primer match ARBITRARIO.
 *
 * Ahora el identificador debe matchear EXACTO:
 * - telegramId numérico completo (User.telegramId es único global), o
 * - teléfono completo → `phoneNormalized` (últimos 10 dígitos, el espejo
 *   indexado que escribe cada write-path de `phone` en la web y el bot).
 *
 * Sin match exacto no se toca nada: se devuelven hasta 5 candidatos
 * (fragmento de teléfono o nombre) para que el admin confirme con botones
 * inline `mkadm_<userId>` / `rmadm_<userId>` — la confirmación es explícita.
 */
export async function findAdminCommandTarget(
    prisma: PrismaClient,
    businessId: string,
    identifier: string,
): Promise<{ match: AdminTargetUser | null; candidates: AdminTargetUser[] }> {
    const digits = identifier.replace(/\D/g, '')
    // normalizePhone (lib/utils, la de la web) recorta a los últimos 10
    // dígitos — la forma comparable que guarda User.phoneNormalized.
    const phoneNorm = normalizePhoneLookup(identifier)

    const exactOr: { telegramId?: string; phoneNormalized?: string }[] = []
    if (/^\d{5,20}$/.test(identifier)) exactOr.push({ telegramId: identifier })
    if (phoneNorm.length >= 7) exactOr.push({ phoneNormalized: phoneNorm })

    if (exactOr.length > 0) {
        const exact = await prisma.user.findMany({
            where: { businessId, OR: exactOr },
            select: ADMIN_TARGET_SELECT,
            orderBy: { name: 'asc' },
            take: MAX_ADMIN_CANDIDATES + 1,
        })
        if (exact.length === 1) return { match: exact[0], candidates: [] }
        // Un teléfono de 9-10 dígitos puede coincidir a la vez con un
        // telegramId ajeno: si el exacto es ambiguo, también se confirma.
        if (exact.length > 1) return { match: null, candidates: exact.slice(0, MAX_ADMIN_CANDIDATES) }
    }

    const candidateOr: { name?: { contains: string; mode: 'insensitive' }; phone?: { contains: string }; phoneNormalized?: { contains: string }; telegramId?: { contains: string } }[] = [
        { name: { contains: identifier, mode: 'insensitive' } },
    ]
    if (digits.length >= 4) {
        candidateOr.push({ phoneNormalized: { contains: digits } })
        candidateOr.push({ phone: { contains: digits } })
    }
    if (/^\d{5,}$/.test(identifier)) candidateOr.push({ telegramId: { contains: identifier } })

    const candidates = await prisma.user.findMany({
        where: { businessId, OR: candidateOr },
        select: ADMIN_TARGET_SELECT,
        orderBy: { name: 'asc' },
        take: MAX_ADMIN_CANDIDATES,
    })
    return { match: null, candidates }
}

/** Botones `mkadm_<id>`/`rmadm_<id>` con nombre + teléfono o telegramId. */
function adminCandidateButtons(candidates: AdminTargetUser[], prefix: 'mkadm_' | 'rmadm_') {
    return candidates.map(u => {
        const contact = u.phone ? ` · ${u.phone}` : u.telegramId ? ` · tg:${u.telegramId}` : ''
        const label = `${u.name}${contact}`.slice(0, 60)
        return [Markup.button.callback(label, `${prefix}${u.id}`)]
    })
}

/**
 * Promueve a ADMIN dentro del tenant del actor, con bitácora USER_UPDATE
 * (misma action que el PATCH web de /api/users/[id]) y aviso al afectado.
 */
async function applyMakeAdmin(
    ctx: Context,
    bot: BotContext['bot'],
    prisma: PrismaClient,
    actor: { id: string; businessId: string },
    target: AdminTargetUser,
) {
    if (target.role === 'ADMIN') {
        return ctx.reply(`⚠️ *${escapeMarkdownV1(target.name)}* ya es administrador.`, { parse_mode: 'Markdown' })
    }

    await prisma.user.update({
        where: { id: target.id },
        data: { role: 'ADMIN' }
    })

    await recordAudit(prisma, {
        businessId: actor.businessId,
        actorId: actor.id,
        action: 'USER_UPDATE',
        entity: 'user',
        entityId: target.id,
        entityName: target.name,
        summary: `Rol ${target.role} → ADMIN desde el bot`,
        changes: { rol: { before: target.role, after: 'ADMIN' } },
    })

    await ctx.reply(`✅ *${escapeMarkdownV1(target.name)}* ahora es administrador. 👑

📱 Tel: ${escapeMarkdownV1(target.phone || 'N/A')}
🆔 Telegram: ${escapeMarkdownV1(target.telegramId || 'N/A')}`, { parse_mode: 'Markdown' })

    if (target.telegramId) {
        bot.telegram.sendMessage(target.telegramId, `👑 *¡Ahora eres Administrador!*

Un administrador te ha otorgado permisos de administrador.
Usa /admin para ver el panel de administración.`, { parse_mode: 'Markdown' }).catch(() => { })
    }
}

/**
 * Degrada ADMIN → CUSTOMER dentro del tenant del actor, con bitácora
 * USER_UPDATE y aviso al afectado. El auto-degrade se bloquea en el caller.
 */
async function applyRemoveAdmin(
    ctx: Context,
    bot: BotContext['bot'],
    prisma: PrismaClient,
    actor: { id: string; businessId: string },
    target: AdminTargetUser,
) {
    if (target.role !== 'ADMIN') {
        return ctx.reply(`⚠️ *${escapeMarkdownV1(target.name)}* no es administrador.`, { parse_mode: 'Markdown' })
    }

    await prisma.user.update({
        where: { id: target.id },
        data: { role: 'CUSTOMER' }
    })

    await recordAudit(prisma, {
        businessId: actor.businessId,
        actorId: actor.id,
        action: 'USER_UPDATE',
        entity: 'user',
        entityId: target.id,
        entityName: target.name,
        summary: `Rol ADMIN → CUSTOMER desde el bot`,
        changes: { rol: { before: 'ADMIN', after: 'CUSTOMER' } },
    })

    await ctx.reply(`✅ *${escapeMarkdownV1(target.name)}* ya no es administrador.

📱 Tel: ${escapeMarkdownV1(target.phone || 'N/A')}
🆔 Telegram: ${escapeMarkdownV1(target.telegramId || 'N/A')}`, { parse_mode: 'Markdown' })

    if (target.telegramId) {
        bot.telegram.sendMessage(target.telegramId, `ℹ️ *Tu rol de administrador ha sido removido.*

Ahora tienes acceso como cliente regular.`, { parse_mode: 'Markdown' }).catch(() => { })
    }
}

export function registerUsers({ bot, prisma, sessions }: BotContext) {
    // /admin panel
    bot.command('admin', async (ctx) => {
        if (!(await requireAdmin(ctx))) return
        await ctx.reply(`👑 *Panel de Administración*

📦 *Gestión de Productos:*
/agregar - Agregar nuevo producto
/stock - Actualizar stock (ej: /stock 123 50)
/eliminar \<producto\> - Eliminar producto

🔧 *Taller:*
/orden - Nueva orden de reparación (wizard)

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

    // /makeadmin — match EXACTO (telegramId o teléfono completo); sin match,
    // candidatos con confirmación inline. Nunca al primer `contains`.
    bot.command('makeadmin', async (ctx) => {
        if (!(await requirePrisma(ctx))) return
        // Un solo findUnique para gate + tenant del actor.
        const actor = await requireAdminAccount(ctx, prisma)
        if (!actor) return

        const args = ctx.message.text.split(' ')
        if (args.length !== 2) {
            return ctx.reply('Uso: /makeadmin <telefono|telegram_id>\nEj: /makeadmin 5512345678')
        }

        const identifier = args[1].trim()

        try {
            // Multi-tenant: solo puede promover usuarios de SU negocio.
            const { match, candidates } = await findAdminCommandTarget(prisma, actor.businessId, identifier)

            if (match) {
                return await applyMakeAdmin(ctx, bot, prisma, actor, match)
            }
            if (candidates.length === 0) {
                return ctx.reply('❌ Usuario no encontrado. Escribe el telegramId o el teléfono completo.')
            }
            await ctx.reply(`🤔 *Sin match exacto para "${escapeMarkdownV1(identifier)}".* ¿A cuál de estos usuarios quieres hacer administrador?`, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    ...adminCandidateButtons(candidates, 'mkadm_'),
                    [Markup.button.callback('❌ Cancelar', 'cancel_admin_op')]
                ])
            })

        } catch (e) {
            console.error('Error making admin:', errorText(e))
            await ctx.reply('❌ Error al procesar la solicitud.')
        }
    })

    // /removeadmin — mismas reglas que /makeadmin.
    bot.command('removeadmin', async (ctx) => {
        if (!(await requirePrisma(ctx))) return
        // Un solo findUnique para gate + tenant del actor.
        const actor = await requireAdminAccount(ctx, prisma)
        if (!actor) return

        const telegramId = ctx.from.id.toString()
        const args = ctx.message.text.split(' ')
        if (args.length !== 2) {
            return ctx.reply('Uso: /removeadmin <telefono|telegram_id>\nEj: /removeadmin 5512345678')
        }

        const identifier = args[1].trim()

        try {
            // Multi-tenant: solo puede degradar admins de SU negocio.
            const { match, candidates } = await findAdminCommandTarget(prisma, actor.businessId, identifier)

            if (match) {
                if (match.telegramId === telegramId) {
                    return ctx.reply('❌ No puedes quitarte el rol de administrador a ti mismo.')
                }
                return await applyRemoveAdmin(ctx, bot, prisma, actor, match)
            }
            if (candidates.length === 0) {
                return ctx.reply('❌ Usuario no encontrado. Escribe el telegramId o el teléfono completo.')
            }
            await ctx.reply(`🤔 *Sin match exacto para "${escapeMarkdownV1(identifier)}".* ¿A cuál de estos usuarios quieres quitar el rol de administrador?`, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    ...adminCandidateButtons(candidates, 'rmadm_'),
                    [Markup.button.callback('❌ Cancelar', 'cancel_admin_op')]
                ])
            })

        } catch (e) {
            console.error('Error removing admin:', errorText(e))
            await ctx.reply('❌ Error al procesar la solicitud.')
        }
    })

    // Confirmación inline de /makeadmin: el admin elige al candidato exacto.
    bot.action(/^mkadm_(.+)$/, async (ctx) => {
        const targetId = ctx.match[1]
        try {
            const actor = await getBotAccount(prisma, ctx.from.id.toString())
            if (!actor) return ctx.answerCbQuery('Cuenta no disponible')
            if (actor.role !== 'ADMIN' || actor.status !== 'APPROVED') {
                return ctx.answerCbQuery('Solo administradores pueden hacer esto')
            }
            const target = await prisma.user.findFirst({
                where: { id: targetId, businessId: actor.businessId },
                select: ADMIN_TARGET_SELECT,
            })
            if (!target) {
                await ctx.answerCbQuery('Usuario no encontrado')
                return ctx.editMessageText('❌ El usuario ya no existe en tu negocio.')
            }
            await ctx.answerCbQuery().catch(() => { })
            await applyMakeAdmin(ctx, bot, prisma, actor, target)
        } catch (e) {
            console.error('Error confirming makeadmin:', errorText(e))
            ctx.answerCbQuery('❌ Error').catch(() => { })
        }
    })

    // Confirmación inline de /removeadmin.
    bot.action(/^rmadm_(.+)$/, async (ctx) => {
        const targetId = ctx.match[1]
        try {
            const actor = await getBotAccount(prisma, ctx.from.id.toString())
            if (!actor) return ctx.answerCbQuery('Cuenta no disponible')
            if (actor.role !== 'ADMIN' || actor.status !== 'APPROVED') {
                return ctx.answerCbQuery('Solo administradores pueden hacer esto')
            }
            const target = await prisma.user.findFirst({
                where: { id: targetId, businessId: actor.businessId },
                select: ADMIN_TARGET_SELECT,
            })
            if (!target) {
                await ctx.answerCbQuery('Usuario no encontrado')
                return ctx.editMessageText('❌ El usuario ya no existe en tu negocio.')
            }
            if (target.telegramId === ctx.from.id.toString()) {
                await ctx.answerCbQuery('❌ No puedes quitarte el rol a ti mismo.')
                return ctx.editMessageText('❌ No puedes quitarte el rol de administrador a ti mismo.')
            }
            await ctx.answerCbQuery().catch(() => { })
            await applyRemoveAdmin(ctx, bot, prisma, actor, target)
        } catch (e) {
            console.error('Error confirming removeadmin:', errorText(e))
            ctx.answerCbQuery('❌ Error').catch(() => { })
        }
    })

    // Botón "❌ Cancelar" del teclado de candidatos de make/removeadmin.
    bot.action('cancel_admin_op', async (ctx) => {
        await ctx.answerCbQuery().catch(() => { })
        await ctx.editMessageText('❌ Operación cancelada.').catch(() => { })
    })

    // /desvincular — quita el telegramId PROPIO tras confirmación inline.
    // Solo el propio: el callback actúa siempre sobre ctx.from, nunca sobre
    // un userId arbitrario del payload.
    bot.command('desvincular', async (ctx) => {
        if (!(await requirePrisma(ctx))) return
        const telegramId = ctx.from.id.toString()
        try {
            const user = await prisma.user.findUnique({
                where: { telegramId },
                select: { id: true, name: true, businessId: true },
            })
            if (!user) return ctx.reply('ℹ️ Esta cuenta de Telegram no está vinculada a ningún usuario.')

            // Advertencia cuando es el único canal de Telegram del negocio:
            // se permite igual, pero el admin debe saber que se queda sordo.
            const linkedCount = await prisma.user.count({
                where: { businessId: user.businessId, telegramId: { not: null } },
            })
            const warn = linkedCount <= 1
                ? '\n\n⚠️ Eres el *único* Telegram vinculado de tu negocio: las alertas (reservas, stock, turnos) dejarán de llegar por aquí.'
                : ''

            await ctx.reply(`🔗 *Desvincular Telegram*

Se quitará la vinculación de esta cuenta de Telegram con *${escapeMarkdownV1(user.name)}*. Podrás seguir usando la app web, pero el bot ya no te reconocerá.${warn}

¿Confirmas?`, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Sí, desvincular', 'unlink_confirm')],
                    [Markup.button.callback('❌ No', 'unlink_cancel')]
                ])
            })
        } catch (e) {
            console.error('Error en /desvincular:', errorText(e))
            await ctx.reply('❌ Error al procesar la solicitud.')
        }
    })

    bot.action('unlink_confirm', async (ctx) => {
        const telegramId = ctx.from.id.toString()
        try {
            // Se desvincula SIEMPRE la cuenta del que pulsa (ctx.from), no la
            // que pidió el comando — un teclado reenviado no desvincula a otro.
            const user = await prisma.user.findUnique({
                where: { telegramId },
                select: { id: true, name: true },
            })
            if (!user) {
                await ctx.answerCbQuery('Ya está desvinculada')
                return ctx.editMessageText('ℹ️ Esta cuenta de Telegram ya no está vinculada.').catch(() => { })
            }
            await prisma.user.update({ where: { id: user.id }, data: { telegramId: null } })
            await ctx.answerCbQuery('Desvinculada').catch(() => { })
            await ctx.editMessageText(`✅ Telegram desvinculado de *${escapeMarkdownV1(user.name)}*.\n\nPara volver a vincularla genera un código nuevo desde la app (verificación por Telegram).`, { parse_mode: 'Markdown' }).catch(() => { })
        } catch (e) {
            console.error('Error en unlink_confirm:', errorText(e))
            await ctx.answerCbQuery('❌ Error').catch(() => { })
        }
    })

    bot.action('unlink_cancel', async (ctx) => {
        await ctx.answerCbQuery().catch(() => { })
        await ctx.editMessageText('❌ Desvinculación cancelada.').catch(() => { })
    })

    // Registration type buttons
    bot.action(/^reg_type_(\d+)$/, async (ctx) => {
        const typeId = ctx.match[1]
        const telegramId = ctx.from.id.toString()
        const regSession = sessions.registration[telegramId]

        if (!regSession || regSession.step !== 'TYPE') {
            return ctx.answerCbQuery('⚠️ Sesión expirada o paso incorrecto.')
        }

        // Toast cosmético: el paso del wizard lo lleva el editMessageText.
        await ctx.answerCbQuery().catch(() => { })

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

        // Toast cosmético: el wizard continúa en submitRegistration aunque falle.
        await ctx.answerCbQuery().catch(() => { })

        const goal = goalValue === 0 ? null : goalValue

        try {
            await submitRegistration({ prisma, bot, sessions }, ctx, goal ?? 0)
        } catch (e) {
            console.error('[RegWizard] DB Error (goal button):', errorText(e))
            delete sessions.registration[telegramId]
            await ctx.reply('⚠️ Hubo un error guardando tu registro. Intenta de nuevo con /start')
        }
    })

    // Contact handler (phone sharing)
    bot.on('contact', async (ctx) => {
        const telegramId = ctx.from.id.toString()
        const regSession = sessions.registration[telegramId]
        if (!regSession || regSession.step !== 'PHONE') return
        const contact = ctx.message.contact
        // Solo aceptar el contacto PROPIO del usuario: una tarjeta reenviada
        // de un tercero (user_id distinto o ausente) no es su teléfono.
        if (contact.user_id !== ctx.from.id) {
            await ctx.reply('❌ Comparte tu propio contacto con el botón de Telegram, o escribe tu teléfono, ej: 5512345678')
            return
        }
        const phone = contact.phone_number
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

    // Approve user — solo solicitudes vigentes. Un botón viejo "✅ Aprobar"
    // sobre una cuenta ya decidida NO re-aprueba ni pisa customerType con el
    // requestedCustomerType obsoleto (antes lo hacía sobre APPROVED también).
    bot.action(/^approve_user_(.+)$/, async (ctx) => {
        const userId = ctx.match[1]

        try {
            // Un solo lookup: antes isAdmin y getBotAccount leían la misma fila.
            const actor = await getBotAccount(prisma, ctx.from.id.toString())
            if (!actor) return ctx.answerCbQuery('Cuenta no disponible')
            if (actor.role !== 'ADMIN' || actor.status !== 'APPROVED') {
                return ctx.answerCbQuery('Solo administradores pueden hacer esto')
            }
            // Multi-tenant: un admin solo aprueba solicitudes de SU negocio.
            const target = await prisma.user.findFirst({ where: { id: userId, businessId: actor.businessId } })
            if (!target) {
                await ctx.answerCbQuery('Usuario no encontrado')
                return ctx.editMessageText('❌ Solicitud no encontrada en tu negocio.')
            }

            // Guard de estado: aprobar solo PENDING o REJECTED. Si ya está
            // aprobada (doble click, teclado viejo) no se toca nada.
            if (target.status !== 'PENDING' && target.status !== 'REJECTED') {
                await ctx.answerCbQuery('Ya fue procesado')
                return ctx.editMessageText(`ℹ️ La solicitud de <b>${escapeHtml(target.name)}</b> ya fue procesada (estatus: ${escapeHtml(target.status)}).`, { parse_mode: 'HTML' })
            }

            // El tipo pedido al registrarse aplica SOLO en la primera
            // aprobación (PENDING → APPROVED): un Técnico/Tienda recibe su
            // lista de precios. Re-aprobar una cuenta suspendida (REJECTED)
            // NO toca customerType — pudo ser curado por un admin después
            // y requestedCustomerType quedó obsoleto.
            const applyRequestedType = target.status === 'PENDING'
            const user = await prisma.user.update({
                where: { id: target.id },
                data: {
                    status: 'APPROVED',
                    ...(applyRequestedType ? { customerType: target.requestedCustomerType } : {})
                }
            })

            // Bitácora como el PATCH web: USER_UPDATE con diff antes→después.
            await recordAudit(prisma, {
                businessId: actor.businessId,
                actorId: actor.id,
                action: 'USER_UPDATE',
                entity: 'user',
                entityId: user.id,
                entityName: user.name,
                summary: `Aprobó la cuenta de "${user.name}" desde el bot`,
                changes: {
                    estatus: { before: target.status, after: 'APPROVED' },
                    ...(applyRequestedType && target.customerType !== user.customerType
                        ? { tipoCliente: { before: target.customerType, after: user.customerType } }
                        : {}),
                },
            })

            await ctx.answerCbQuery('Usuario aprobado')
            await ctx.editMessageText(`✅ <b>Usuario Aprobado</b>\n\n📛 ${escapeHtml(user.name)}\n📱 ${escapeHtml(user.phone)}\n🏷️ ${escapeHtml(customerTypeLabels[user.customerType] ?? user.customerType)}`, { parse_mode: 'HTML' })

            if (user.telegramId) {
                bot.telegram.sendMessage(user.telegramId, `🎉 <b>¡Tu cuenta ha sido aprobada!</b>\n\nYa puedes ver precios, buscar productos y realizar reservas en nuestro bot.\n\nEscribe "Hola" o el nombre de un producto para comenzar.`, { parse_mode: 'HTML' }).catch(() => { })
            }
        } catch (e) {
            console.error('[Users] approve_user_:', errorText(e))
            ctx.answerCbQuery('Error al aprobar').catch(() => { })
        }
    })

    // Reject user — solo solicitudes PENDING. Un botón viejo "❌ Rechazar"
    // ya no puede suspender (REJECTED) a un usuario APPROVED.
    bot.action(/^reject_user_(.+)$/, async (ctx) => {
        const userId = ctx.match[1]

        try {
            // Un solo lookup: antes isAdmin y getBotAccount leían la misma fila.
            const actor = await getBotAccount(prisma, ctx.from.id.toString())
            if (!actor) return ctx.answerCbQuery('Cuenta no disponible')
            if (actor.role !== 'ADMIN' || actor.status !== 'APPROVED') {
                return ctx.answerCbQuery('Solo administradores pueden hacer esto')
            }
            // Multi-tenant: un admin solo rechaza solicitudes de SU negocio.
            const target = await prisma.user.findFirst({ where: { id: userId, businessId: actor.businessId } })
            if (!target) {
                await ctx.answerCbQuery('Usuario no encontrado')
                return ctx.editMessageText('❌ Solicitud no encontrada en tu negocio.')
            }

            if (target.status !== 'PENDING') {
                await ctx.answerCbQuery('Ya fue procesado')
                return ctx.editMessageText(`ℹ️ La solicitud de <b>${escapeHtml(target.name)}</b> ya fue procesada (estatus: ${escapeHtml(target.status)}).`, { parse_mode: 'HTML' })
            }

            const user = await prisma.user.update({
                where: { id: target.id },
                data: { status: 'REJECTED' }
            })

            await recordAudit(prisma, {
                businessId: actor.businessId,
                actorId: actor.id,
                action: 'USER_UPDATE',
                entity: 'user',
                entityId: user.id,
                entityName: user.name,
                summary: `Rechazó la solicitud de "${user.name}" desde el bot`,
                changes: { estatus: { before: 'PENDING', after: 'REJECTED' } },
            })

            await ctx.answerCbQuery('Usuario rechazado')
            await ctx.editMessageText(`❌ <b>Usuario Rechazado</b>\n\n📛 ${escapeHtml(user.name)}\n📱 ${escapeHtml(user.phone)}`, { parse_mode: 'HTML' })
        } catch (e) {
            console.error('[Users] reject_user_:', errorText(e))
            ctx.answerCbQuery('Error al rechazar').catch(() => { })
        }
    })
}
