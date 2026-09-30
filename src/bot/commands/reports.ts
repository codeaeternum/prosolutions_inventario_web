import { changeReservation } from "../../lib/domain/reservations"
import { moveInventory } from "../../lib/domain/inventory"
import { randomUUID } from "crypto"
import { Markup } from 'telegraf'
import type { InlineKeyboardButton } from 'telegraf/types'
import * as QRCode from 'qrcode'
import type { BotContext } from '../lib/types'
import { customerTypeLabels } from '../lib/types'
import { getBotAccount, requireAdmin, requirePrisma } from '../lib/guards'

function generateProgressBar(percent: number): string {
    const filled = Math.min(10, Math.floor(percent / 10))
    const empty = 10 - filled
    return '█'.repeat(filled) + '░'.repeat(empty)
}

export function registerReports({ bot, prisma }: BotContext) {
    // /stock
    bot.command('stock', async (ctx) => {
        if (!(await requireAdmin(ctx))) return
        if (!(await requirePrisma(ctx))) return

        const args = ctx.message.text.split(' ')
        if (args.length !== 3) {
            return ctx.reply('Uso: /stock [ID_PRODUCTO] [CANTIDAD]\nEj: /stock abc123 50\n\nEl ID lo ves al crear con /agregar o en la web.')
        }

        const [, productId, quantity] = args
        const newStock = parseInt(quantity)

        if (isNaN(newStock) || newStock < 0) {
            return ctx.reply('❌ La cantidad debe ser un número positivo.')
        }

        try {
            const adminUser = await prisma.user.findUnique({
                where: { telegramId: ctx.from!.id.toString() },
                select: { id: true, businessId: true, homeBranchId: true }
            })
            if (!adminUser) return ctx.reply('Cuenta no disponible.')

            // El stock ahora vive por sucursal: /stock fija la existencia de la
            // sucursal del administrador (o la principal) mediante un ajuste.
            const branchId = adminUser.homeBranchId ?? 'branch-principal'
            const branch = await prisma.branch.findUnique({ where: { id: branchId } })
            if (!branch) return ctx.reply('❌ Sucursal no disponible.')
            const current = await prisma.branchStock.findUnique({
                where: { productId_branchId: { productId, branchId: branch.id } }
            })
            const product = await prisma.product.findUnique({ where: { id: productId, businessId: adminUser.businessId }, select: { id: true, name: true, stock: true } })
            if (!product) return ctx.reply('❌ Producto no encontrado.')
            const diff = newStock - (current?.quantity ?? 0)
            if (diff === 0) return ctx.reply(`ℹ️ ${product.name} ya tiene ${newStock} en ${branch.name}.`)
            const result = await moveInventory(prisma, adminUser.id, adminUser.businessId, {
                idempotencyKey: `bot-stock-${ctx.from!.id}-${Date.now()}-${randomUUID()}`,
                items: [{
                    productId, type: diff > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
                    quantity: Math.abs(diff), branchId: branch.id,
                    reason: `Ajuste desde bot: ${branch.name} → ${newStock} unidades`,
                }],
            })
            const movement = result.movements[0]
            await ctx.reply(`✅ Stock actualizado en *${branch.name}*:\n📦 ${product.name}\n📊 ${current?.quantity ?? 0} → ${newStock} unidades (total: ${movement?.newStock ?? '—'})`, { parse_mode: 'Markdown' })
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Error desconocido'
            await ctx.reply(`❌ No se pudo ajustar: ${msg}`)
        }
    })

    // /pendientes
    bot.command('pendientes', async (ctx) => {
        if (!(await requireAdmin(ctx))) return
        if (!(await requirePrisma(ctx))) return

        try {
            const actor = await getBotAccount(prisma, ctx.from!.id.toString())
            if (!actor) return ctx.reply('Cuenta no disponible.')
            const reservations = await prisma.reservation.findMany({
                where: { businessId: actor.businessId, status: { in: ['PENDING', 'PENDING_PAYMENT'] } },
                include: { user: true, product: true },
                orderBy: { createdAt: 'desc' },
                take: 15
            })

            if (reservations.length === 0) {
                return ctx.reply('✅ No hay reservas pendientes.')
            }

            let msg = `📋 *${reservations.length} reserva(s) pendiente(s):*\n\n`
            reservations.forEach((r, i) => {
                const exp = r.expiresAt ? new Date(r.expiresAt).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—'
                const statusLabel = r.status === 'PENDING_PAYMENT' ? '⏳ Pago' : '🛒 Tienda'
                msg += `${i + 1}. *${r.product.name}*\n`
                msg += `   👤 ${r.user.name} | 📊 ${r.quantity} uds | 💰 $${r.totalPrice.toLocaleString()}\n`
                msg += `   📅 Expira: ${exp} | ${statusLabel}\n\n`
            })
            msg += '_Gestiona en la web: Admin → Reservas_'

            await ctx.reply(msg, { parse_mode: 'Markdown' })
        } catch (e) {
            console.error(e)
            await ctx.reply('❌ Error al obtener reservas. Usa /cancelar si estabas en otro proceso.')
        }
    })

    // /caja
    bot.command('caja', async (ctx) => {
        if (!(await requireAdmin(ctx))) return
        if (!(await requirePrisma(ctx))) return

        try {
            const actor = await getBotAccount(prisma, ctx.from!.id.toString())
            if (!actor) return ctx.reply('Cuenta no disponible.')
            const register = await prisma.cashRegister.findFirst({
                where: { businessId: actor.businessId, status: 'OPEN' },
                include: {
                    openedBy: { select: { name: true } },
                    movements: { orderBy: { createdAt: 'desc' }, take: 5, include: { user: { select: { name: true } } } }
                }
            })

            if (!register) {
                return ctx.reply('🔒 *La caja está cerrada.*\n\nAbre la caja desde la web: Admin → Caja', { parse_mode: 'Markdown' })
            }

            // Totales sobre TODOS los movimientos del turno — el include de
            // arriba solo trae los últimos 5 para mostrarlos en el listado.
            const totals = await prisma.cashMovement.groupBy({
                by: ['type'],
                where: { registerId: register.id },
                _sum: { amount: true },
            })
            const totalIn = totals.find(t => t.type === 'IN')?._sum.amount ?? 0
            const totalOut = totals.find(t => t.type === 'OUT')?._sum.amount ?? 0

            let msg = `🟢 *Caja Abierta*\n\n`
            msg += `💰 Monto inicial: $${register.initialAmount.toLocaleString()}\n`
            msg += `📈 Entradas: $${totalIn.toLocaleString()}\n`
            msg += `📉 Salidas: $${totalOut.toLocaleString()}\n`
            msg += `💵 Total esperado: $${(register.initialAmount + totalIn - totalOut).toLocaleString()}\n`
            msg += `👤 Abrió: ${register.openedBy?.name || 'N/A'}\n`
            msg += `🕐 Desde: ${new Date(register.openedAt).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}\n`

            if (register.movements.length > 0) {
                msg += `\n📋 *Últimos movimientos:*\n`
                register.movements.forEach((m) => {
                    const icon = m.type === 'IN' ? '🟢' : '🔴'
                    msg += `${icon} $${m.amount.toLocaleString()} — ${m.description?.substring(0, 30) || 'Sin desc.'}\n`
                })
            }

            await ctx.reply(msg, { parse_mode: 'Markdown' })
        } catch (e) {
            console.error(e)
            await ctx.reply('❌ Error al consultar caja.')
        }
    })

    // /credito
    bot.command('credito', async (ctx) => {
        if (!(await requireAdmin(ctx))) return
        if (!(await requirePrisma(ctx))) return

        try {
            const actor = await getBotAccount(prisma, ctx.from!.id.toString())
            if (!actor) return ctx.reply('Cuenta no disponible.')
            const debtors = await prisma.user.findMany({
                where: { businessId: actor.businessId, creditBalance: { gt: 0 } },
                select: { name: true, creditBalance: true, creditLimit: true, phone: true },
                orderBy: { creditBalance: 'desc' },
                take: 15
            })

            if (debtors.length === 0) {
                return ctx.reply('✅ *No hay deudores pendientes.*\n\nTodos los créditos están al corriente.', { parse_mode: 'Markdown' })
            }

            const totalDebt = debtors.reduce((s, d) => s + (d.creditBalance ?? 0), 0)
            let msg = `💳 *Créditos Pendientes* (${debtors.length} deudor${debtors.length > 1 ? 'es' : ''})\n\n`
            debtors.forEach((d, i) => {
                const pct = d.creditLimit ? Math.round(((d.creditBalance ?? 0) / d.creditLimit) * 100) : 0
                msg += `${i + 1}. *${d.name}*\n`
                msg += `   💰 Saldo: $${(d.creditBalance ?? 0).toLocaleString()}`
                msg += d.creditLimit ? ` / $${d.creditLimit.toLocaleString()} (${pct}%)` : ''
                msg += `\n`
            })
            msg += `\n━━━━━━━━━━━━━━\n💰 *Total adeudado: $${totalDebt.toLocaleString()}*`
            msg += `\n\n_Gestiona en la web: Admin → Crédito y Cartera_`

            await ctx.reply(msg, { parse_mode: 'Markdown' })
        } catch (e) {
            console.error(e)
            await ctx.reply('❌ Error al consultar créditos.')
        }
    })

    // /reporte
    bot.command('reporte', async (ctx) => {
        if (!(await requireAdmin(ctx))) return
        if (!(await requirePrisma(ctx))) return

        try {
            const actor = await getBotAccount(prisma, ctx.from!.id.toString())
            if (!actor) return ctx.reply('Cuenta no disponible.')
            const today = new Date()
            today.setHours(0, 0, 0, 0)

            // Solo OUT con paymentMethod son ventas del POS — los demás OUT
            // son mermas/ajustes y no deben inflar "Ventas del día".
            const [salesMovements, reservationsToday] = await Promise.all([
                prisma.inventoryMovement.findMany({
                    where: { businessId: actor.businessId, type: 'OUT', paymentMethod: { not: null }, createdAt: { gte: today } },
                    select: { quantity: true, totalPrice: true, product: { select: { name: true } } }
                }),
                prisma.reservation.count({ where: { businessId: actor.businessId, createdAt: { gte: today } } }),
            ])

            const totalSales = salesMovements.length
            const totalItems = salesMovements.reduce((s, m) => s + m.quantity, 0)
            const totalRevenue = salesMovements.reduce((s, m) => s + (m.totalPrice ?? 0), 0)

            let msg = `📊 *Reporte del Día*\n`
            msg += `📅 ${new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}\n\n`
            msg += `🛒 *Ventas:* ${totalSales} operaciones\n`
            msg += `📦 *Productos vendidos:* ${totalItems} uds\n`
            msg += `💰 *Total recaudado:* $${totalRevenue.toLocaleString()}\n`
            msg += `📋 *Reservas hoy:* ${reservationsToday}\n`

            if (totalSales > 0) {
                msg += `\n📈 *Top productos:*\n`
                const grouped: Record<string, number> = {}
                salesMovements.forEach(m => {
                    const name = m.product?.name || 'Desconocido'
                    grouped[name] = (grouped[name] || 0) + m.quantity
                })
                Object.entries(grouped)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .forEach(([name, qty]) => {
                        msg += `   • ${name}: ${qty} uds\n`
                    })
            }

            await ctx.reply(msg, { parse_mode: 'Markdown' })
        } catch (e) {
            console.error(e)
            await ctx.reply('❌ Error al generar reporte.')
        }
    })

    // /historial
    bot.command('historial', async (ctx) => {
        if (!(await requirePrisma(ctx))) return

        const telegramId = ctx.from.id.toString()
        const user = await prisma.user.findUnique({ where: { telegramId } })
        if (user && user.status !== 'APPROVED' && user.role !== 'ADMIN') {
            return ctx.reply('⏳ Tu cuenta está pendiente de verificación o fue rechazada.')
        }
        if (!user) return ctx.reply('⚠️ No estás registrado. Usa /start')

        try {
            const history = await prisma.reservation.findMany({
                where: { userId: user.id, status: { in: ['COMPLETED', 'CANCELLED'] } },
                include: { product: true },
                orderBy: { createdAt: 'desc' },
                take: 10
            })

            if (history.length === 0) {
                return ctx.reply('📜 No tienes historial de compras finalizadas.')
            }

            let msg = `📜 *Historial de Compras:*\n\n`
            history.forEach((r, i) => {
                const statusIcon = r.status === 'COMPLETED' ? '✅' : r.status === 'CANCELLED' ? '❌' : '📦'
                msg += `${i + 1}. ${statusIcon} *${r.product.name}*\n`
                msg += `   📅 ${new Date(r.createdAt).toLocaleDateString()} | 💰 $${r.totalPrice}\n`
                msg += `   📊 ${r.quantity} uds\n\n`
            })

            await ctx.reply(msg, { parse_mode: 'Markdown' })
        } catch (e) {
            console.error(e)
            await ctx.reply('❌ Error al obtener historial.')
        }
    })

    // /perfil
    bot.command('perfil', async (ctx) => {
        if (!(await requirePrisma(ctx))) return

        const telegramId = ctx.from.id.toString()
        const user = await prisma.user.findUnique({ where: { telegramId } })
        if (user && user.status !== 'APPROVED' && user.role !== 'ADMIN') {
            return ctx.reply('⏳ Tu cuenta está pendiente de verificación o fue rechazada.')
        }
        if (!user) return ctx.reply('⚠️ No estás registrado. Usa /start para registrarte.')

        const qrDisplay = user.qrCode || 'Pendiente'
        const tipoCliente = customerTypeLabels[user.customerType] || user.customerType

        let progressMsg = ''
        if (user.monthlyPurchaseGoal && user.monthlyPurchaseGoal > 0) {
            const current = user.currentMonthPurchases || 0
            const progress = (current / user.monthlyPurchaseGoal) * 100
            const progressBar = generateProgressBar(progress)
            progressMsg = `
📊 *Progreso del Mes:*
${progressBar} ${progress.toFixed(0)}%
💰 $${current.toFixed(0)} / $${user.monthlyPurchaseGoal.toFixed(0)}`
        }

        const creditBalance = user.creditBalance ?? 0
        const creditLimit = user.creditLimit
        const creditMsg = (creditLimit != null && creditLimit > 0) || creditBalance > 0
            ? `
💳 *Crédito:*
   Saldo a pagar: $${creditBalance.toLocaleString()}
   ${creditLimit != null ? `Límite: $${creditLimit.toLocaleString()}` : ''}`
            : ''

        try {
            const qrBuffer = await QRCode.toBuffer(qrDisplay)
            ctx.replyWithPhoto({ source: qrBuffer }, {
                caption: `👤 *Tu Perfil*

📛 *Nombre:* ${user.name}
${user.businessName ? `🏢 *Negocio:* ${user.businessName}\n` : ''}📱 *Teléfono:* ${user.phone || 'No registrado'}
🏷️ *Tipo:* ${tipoCliente}
${progressMsg}
${creditMsg}

🔲 *Código: ${qrDisplay}*
_Muestra este código en tienda para identificarte._`,
                parse_mode: 'Markdown'
            })
        } catch {
            await ctx.reply(`👤 *Tu Perfil* (Error gen QR)
        
Código: ${qrDisplay}`, { parse_mode: 'Markdown' })
        }
    })

    // /misreservas
    bot.command('misreservas', async (ctx) => {
        if (!(await requirePrisma(ctx))) return

        const telegramId = ctx.from.id.toString()
        const user = await prisma.user.findUnique({ where: { telegramId } })
        if (user && user.status !== 'APPROVED' && user.role !== 'ADMIN') {
            return ctx.reply('⏳ Tu cuenta está pendiente de verificación o fue rechazada.')
        }
        if (!user) return ctx.reply('⚠️ No estás registrado. Usa /start')

        try {
            const reservations = await prisma.reservation.findMany({
                where: { userId: user.id },
                include: { product: true },
                orderBy: { createdAt: 'desc' },
                take: 5
            })

            if (reservations.length === 0) {
                return ctx.reply('📦 No tienes reservas aún.\n\nBusca productos escribiendo su nombre.')
            }

            const statusLabels: Record<string, string> = {
                PENDING: 'Pendiente (pago en tienda)',
                PENDING_PAYMENT: 'Esperando comprobante',
                DEPOSIT_VERIFIED: 'Depósito verificado',
                COMPLETED: 'Completada',
                CANCELLED: 'Cancelada',
                EXPIRED: 'Expirada'
            }
            for (const r of reservations) {
                let statusEmoji = '🟡'
                if (r.status === 'COMPLETED') statusEmoji = '✅'
                if (r.status === 'CANCELLED' || r.status === 'EXPIRED') statusEmoji = '❌'
                if (r.status === 'PENDING_PAYMENT') statusEmoji = '⏳'

                const msg = `${statusEmoji} *${r.product.name}*
📊 ${r.quantity} uds | 💰 $${r.totalPrice.toLocaleString()}
📅 ${new Date(r.createdAt).toLocaleDateString()}
🔖 ${statusLabels[r.status] ?? r.status}`

                const buttons: InlineKeyboardButton[] = []
                if (['PENDING', 'PENDING_PAYMENT'].includes(r.status)) {
                    buttons.push(Markup.button.callback('❌ Cancelar', `cancel_res_${r.id}`))
                }

                await ctx.reply(msg, {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([buttons])
                })
            }
        } catch (e) {
            console.error(e)
            await ctx.reply('❌ Error al obtener reservas.')
        }
    })

    // cancel_res action
    bot.action(/^cancel_res_(.+)$/, async (ctx) => {
        const reservationId = ctx.match[1]
        const telegramId = ctx.from!.id.toString()
        await ctx.answerCbQuery()

        try {
            const user = await prisma.user.findUnique({ where: { telegramId } })
            if (!user) return

            const reservation = await prisma.reservation.findFirst({
                where: { id: reservationId, userId: user.id },
                include: { product: true }
            })

            if (!reservation) {
                return ctx.reply('❌ No se encontró la reserva.')
            }

            if (!['PENDING', 'PENDING_PAYMENT'].includes(reservation.status)) {
                return ctx.reply('⚠️ Esta reserva ya no se puede cancelar.')
            }

            await changeReservation(prisma, user.id, user.businessId, reservationId, { action: 'cancel' })

            await ctx.editMessageText(`❌ *Reserva Cancelada*\n\n📦 ${reservation.product.name}\nEstado: Cancelado por usuario`, { parse_mode: 'Markdown' })

        } catch (e) {
            console.error(e)
            await ctx.reply('❌ Error al cancelar reserva.')
        }
    })

    // /entregar
    bot.command('entregar', async (ctx) => {
        if (!(await requireAdmin(ctx))) return
        if (!(await requirePrisma(ctx))) return

        const args = ctx.message.text.split(' ')
        if (args.length !== 2) {
            return ctx.reply('Uso: /entregar [ID_RESERVA]\nEj: /entregar 123abcde')
        }

        const reservationIdStart = args[1]

        try {
            const actor = await getBotAccount(prisma, ctx.from!.id.toString())
            if (!actor) return ctx.reply('Cuenta no disponible.')
            const reservation = await prisma.reservation.findFirst({
                where: { businessId: actor.businessId, id: { startsWith: reservationIdStart } },
                include: { user: true, product: true }
            })

            if (!reservation) {
                return ctx.reply('❌ No encontré ninguna reserva con ese ID.')
            }

            if (reservation.status === 'COMPLETED') {
                return ctx.reply('⚠️ Esta reserva ya fue entregada anteriormente.')
            }

            const baseUrl = process.env.NEXTAUTH_URL
            if (!baseUrl) return ctx.reply('Configura la dirección del sistema para confirmar la entrega.')
            await ctx.reply(`Revisa el saldo y selecciona el medio de pago antes de entregar:
${baseUrl}/verificar/${reservation.qrCode}`)

        } catch (e) {
            console.error(e)
            await ctx.reply('❌ Error al procesar entrega.')
        }
    })
}
