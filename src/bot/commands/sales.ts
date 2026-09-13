import { sell } from "../../lib/domain/sales"
import { actor, BusinessError, transaction } from "../../lib/domain/operations"
import { Markup } from 'telegraf'
import type { BotContext, CartItem } from '../lib/types'
import { requireAdmin, requirePrisma } from '../lib/guards'
import { notifyAdmins } from '../lib/notify'

export function registerSales({ bot, prisma, sessions, isDev }: BotContext) {
    // /vender
    bot.command('vender', async (ctx) => {
        const telegramId = ctx.from.id.toString()
        if (!(await requireAdmin(ctx))) return
        if (!(await requirePrisma(ctx))) return

        const args = ctx.message.text.split(' ').slice(1).join(' ').trim()

        if (!args) {
            return ctx.reply(`🛒 *Venta Rápida*

Uso: /vender <nombre_producto>

Ejemplo:
/vender pantalla iphone 14
/vender bateria samsung

Luego eliges producto y cantidad.
_O usa /agregarc para vender varios en el carrito._`, { parse_mode: 'Markdown' })
        }

        try {
            const products = await prisma.product.findMany({
                where: {
                    OR: [
                        { name: { contains: args, mode: 'insensitive' } },
                        { barcode: args }
                    ],
                    stock: { gt: 0 }
                },
                take: 5,
                select: { id: true, name: true, stock: true, retailPrice: true }
            })

            if (products.length === 0) {
                return ctx.reply(`❌ No se encontraron productos con stock para: "${args}"`)
            }

            if (products.length === 1) {
                sessions.sale[telegramId] = {
                    step: 'CONFIRM',
                    selectedProduct: products[0],
                    quantity: 1
                }

                return ctx.reply(`📦 *${products[0].name}*

📊 Stock: ${products[0].stock} unidades
💰 Precio: $${products[0].retailPrice.toLocaleString()}

¿Cuántas unidades vender? (escribe un número o /cancelar)`, { parse_mode: 'Markdown' })
            }

            sessions.sale[telegramId] = { step: 'SELECT_PRODUCT', products }

            const productList = products.map((p: { name: string; stock: number; retailPrice: number }, i: number) =>
                `${i + 1}. *${p.name}*\n   Stock: ${p.stock} | $${p.retailPrice.toLocaleString()}`
            ).join('\n\n')

            await ctx.reply(`📦 *Productos encontrados:*

${productList}

Responde con el número (1-${products.length}) para seleccionar o /cancelar`, { parse_mode: 'Markdown' })

        } catch (e) {
            if (isDev) console.error('Error in /vender:', e)
            await ctx.reply('❌ Error al buscar productos. Usa /cancelar si estabas en otro proceso.')
        }
    })

    // cancel_sale action
    bot.action('cancel_sale', async (ctx) => {
        const telegramId = ctx.from!.id.toString()
        delete sessions.sale[telegramId]
        await ctx.answerCbQuery()
        await ctx.editMessageText('❌ Venta cancelada.')
    })

    // confirm_sale action
    bot.action(/^confirm_sale_(.+)_(\d+)$/, async (ctx) => {
        const telegramId = ctx.from!.id.toString()
        if (!(await requireAdmin(ctx))) return

        const productId = ctx.match[1]
        const number = parseInt(ctx.match[2])

        try {
            const product = await prisma.product.findUnique({
                where: { id: productId },
                select: { id: true, name: true, stock: true, retailPrice: true }
            })

            if (!product || product.stock < number) {
                delete sessions.sale[telegramId]
                await ctx.answerCbQuery('Stock insuficiente')
                return ctx.editMessageText('❌ Stock insuficiente.')
            }

            const adminUser = await prisma.user.findUnique({
                where: { telegramId },
                select: { id: true, businessId: true }
            })

            if (!adminUser) return ctx.reply('Cuenta no disponible.')
            const result = await sell(prisma, adminUser.id, adminUser.businessId, {
                idempotencyKey: `bot-sale:${telegramId}:${ctx.callbackQuery.message?.message_id ?? ctx.update.update_id}`,
                items: [{ productId, quantity: number }], paymentMethod: 'EFECTIVO',
            })
            const total = result.total
            delete sessions.sale[telegramId]

            const successMsg = `✅ *¡Venta registrada!*

📦 ${product.name}
🔢 Cantidad: ${number}
💰 Total: $${total.toLocaleString()}
📊 Stock restante: ${product.stock - number}`

            await ctx.answerCbQuery('Venta confirmada')
            await ctx.editMessageText(successMsg, { parse_mode: 'Markdown' })

            notifyAdmins(bot, `📢 *Nueva Venta (Bot)*
        
👤 Por: Admin
${successMsg}`)

        } catch (e: any) {
            console.error('Error processing sale:', e)
            delete sessions.sale[telegramId]
            await ctx.answerCbQuery('Error')
            await ctx.editMessageText(`❌ Error al procesar la venta.`)
        }
    })

    // fastsell action (from catalog)
    bot.action(/^fastsell_(.+)$/, async (ctx) => {
        const productId = ctx.match[1]
        await ctx.answerCbQuery()

        const product = await prisma.product.findUnique({
            where: { id: productId },
            select: { id: true, name: true, stock: true, retailPrice: true }
        })
        if (!product || product.stock < 1) return ctx.reply('❌ Sin stock.')

        const telegramId = ctx.from.id.toString()
        sessions.sale[telegramId] = {
            step: 'CONFIRM',
            selectedProduct: product,
            quantity: 1
        }

        await ctx.reply(`📦 *Venta Rápida: ${product.name}*

Precio: $${product.retailPrice}
Cantidad: 1

¿Confirmar venta? (Escribe SI)`, { parse_mode: 'Markdown' })
    })

    // Number handler for sale sessions, QR, cart, delete
    bot.hears(/^\d+$/, async (ctx, next) => {
        const telegramId = ctx.from.id.toString()
        if (sessions.registration[telegramId]?.step === 'GOAL') {
            return next()
        }
        const number = parseInt(ctx.message.text)

        // QR session
        const qrSession = sessions.qr[telegramId]
        if (qrSession && qrSession.step === 'SELECT' && qrSession.products) {
            if (number < 1 || number > qrSession.products.length) {
                return ctx.reply(`Ingresa un número entre 1 y ${qrSession.products.length}`)
            }
            const p = qrSession.products[number - 1]
            const qrData = p.barcode || p.id
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrData)}`
            delete sessions.qr[telegramId]
            await ctx.replyWithPhoto({ url: qrUrl }, {
                caption: `📱 *${p.name}*\n\nCódigo: \`${qrData}\``,
                parse_mode: 'Markdown'
            })
            return
        }

        // Cart pending add
        const cart = sessions.cart[telegramId]
        if (cart?.pendingAdd) {
            const pending = cart.pendingAdd
            if (number < 1 || number > pending.stock) {
                return ctx.reply(`❌ Cantidad inválida. Stock disponible: ${pending.stock}`)
            }

            const existingIndex = cart.items.findIndex(item => item.id === pending.id)
            if (existingIndex >= 0) {
                cart.items[existingIndex].quantity += number
            } else {
                cart.items.push({
                    id: pending.id,
                    name: pending.name,
                    quantity: number,
                    price: pending.price,
                    stock: pending.stock
                })
            }
            cart.pendingAdd = undefined

            const total = cart.items.reduce((sum: number, item: CartItem) => sum + item.quantity * item.price, 0)
            return ctx.reply(`✅ *Agregado al carrito*

📦 ${pending.name} × ${number}
💰 Subtotal: $${(pending.price * number).toLocaleString()}

🛒 *Total carrito: $${total.toLocaleString()}*

/carrito - Ver carrito
/agregarc <producto> - Agregar más
/confirmarc - Confirmar venta`, { parse_mode: 'Markdown' })
        }

        // Sale session
        const session = sessions.sale[telegramId]
        if (session) {
            if (session.step === 'SELECT_PRODUCT' && session.products) {
                if (number < 1 || number > session.products.length) {
                    return ctx.reply(`Ingresa un número entre 1 y ${session.products.length}`)
                }
                const selected = session.products[number - 1]
                sessions.sale[telegramId] = { step: 'CONFIRM', selectedProduct: selected, quantity: 1 }
                return ctx.reply(`📦 *${selected.name}*

📊 Stock: ${selected.stock} unidades
💰 Precio: $${selected.retailPrice.toLocaleString()}

¿Cuántas unidades vender?`, { parse_mode: 'Markdown' })
            }

            if (session.step === 'CONFIRM' && session.selectedProduct) {
                if (number < 1 || number > session.selectedProduct.stock) {
                    return ctx.reply(`❌ Cantidad inválida. Stock disponible: ${session.selectedProduct.stock}`)
                }
                sessions.sale[telegramId] = { step: 'CONFIRM', selectedProduct: session.selectedProduct, quantity: number }
                const total = session.selectedProduct.retailPrice * number
                return ctx.reply(`📦 *Resumen de venta*

Producto: ${session.selectedProduct.name}
Cantidad: ${number}
Total: *$${total.toLocaleString()}*

¿Confirmar venta?`, {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('✅ Confirmar', `confirm_sale_${session.selectedProduct.id}_${number}`)],
                        [Markup.button.callback('❌ Cancelar', 'cancel_sale')]
                    ])
                })
            }
        }

        // Delete product session
        const deleteSession = sessions.deleteProduct[telegramId]
        if (deleteSession && deleteSession.step === 'SELECT' && deleteSession.products) {
            if (number < 1 || number > deleteSession.products.length) {
                return ctx.reply(`Ingresa un número entre 1 y ${deleteSession.products.length}`)
            }
            const selected = deleteSession.products[number - 1]
            sessions.deleteProduct[telegramId] = { step: 'CONFIRM', selectedProduct: selected }
            return ctx.reply(`🗑️ *¿Eliminar este producto?*

📦 *${selected.name}*
📊 Stock: ${selected.stock}
🔗 Reservas: ${selected._count?.reservations ?? 0}
📋 Movimientos: ${selected._count?.movements ?? 0}

¿Confirmar eliminación?`, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Eliminar', `confirm_delete_${selected.id}`)],
                    [Markup.button.callback('❌ Cancelar', 'cancel_sale')]
                ])
            })
        }

        return next()
    })

    // Legacy SI confirmation
    bot.hears(/^(SI|si|Si|sI|Si|sí|SÍ)$/, async (ctx) => {
        const telegramId = ctx.from.id.toString()
        const deleteSession = sessions.deleteProduct[telegramId]
        if (deleteSession && deleteSession.step === 'CONFIRM' && deleteSession.selectedProduct && prisma) {
            if (!(await requireAdmin(ctx))) return
            if (!(await requirePrisma(ctx))) return
            try {
                const productId = deleteSession.selectedProduct.id
                await transaction(prisma, async tx => {
                    const currentUser = await tx.user.findUnique({ where: { telegramId }, select: { id: true } })
                    if (!currentUser) throw new BusinessError('Cuenta no autorizada.', 403)
                    await actor(tx, currentUser.id, 'admin')
                    await tx.product.update({ where: { id: productId }, data: { isActive: false } })
                })
                const productName = deleteSession.selectedProduct.name
                delete sessions.deleteProduct[telegramId]
                return ctx.reply(`✅ *Producto archivado*\n\n📦 ${productName}\n\nSus existencias, reservas y movimientos se conservaron.`, { parse_mode: 'Markdown' })
            } catch (e) {
                if (isDev) console.error('Error archiving product:', e)
                delete sessions.deleteProduct[telegramId]
                return ctx.reply('❌ No se pudo archivar el producto. Revisa tus permisos e inténtalo de nuevo.')
            }
        }
    })
}
